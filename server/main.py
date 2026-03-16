"""
ADK Streaming Server — FastAPI WebSocket bridge for the Chrome Extension.

Architecture:
  Chrome Extension (offscreen.js)
      ↕ WebSocket (ws://localhost:8080/ws)
  FastAPI Server (this file)
      ↕ ADK runner.run_live()
  Gemini Live API

Upstream (extension → Gemini):
  - Binary messages → audio PCM chunks → LiveRequestQueue.send_realtime()
  - JSON messages   → screenshots      → LiveRequestQueue.send_realtime()

Downstream (Gemini → extension):
  - ADK Events with inline audio data → JSON {"type":"audio","data":"<b64>"}
  - Interruption events               → JSON {"type":"interrupted"}
  - Turn complete events               → JSON {"type":"turn_complete"}
"""

import asyncio
import base64
import json
import os
import uuid

from pydantic import BaseModel
from dotenv import load_dotenv
import os
import glob
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from google.adk.agents.live_request_queue import LiveRequestQueue
from google.adk.agents.run_config import RunConfig, StreamingMode
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google import genai
from google.genai import types

from app.agent import root_agent
from app.shield_agent import shield_agent
from app.tools import (
    clear_websocket,
    is_audio_paused,
    resolve_action,
    set_live_queue,
    set_websocket,
)

# ════════════════════════════════════════
# Phase 1: Application Initialization
# ════════════════════════════════════════

load_dotenv()

APP_NAME = "autopilot-bridge"
app = FastAPI(title="Autopilot Bridge ADK Server")

session_service = InMemorySessionService()

talk_runner = Runner(
    app_name=APP_NAME,
    agent=root_agent,
    session_service=session_service,
)

shield_runner = Runner(
    app_name=APP_NAME,
    agent=shield_agent,
    session_service=session_service,
)


# ════════════════════════════════════════
# WebSocket Endpoint
# ════════════════════════════════════════

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    await websocket.accept()
    
    # Get mode from query parameters (e.g. ws://.../ws?mode=shield)
    mode = websocket.query_params.get("mode", "talk")
    print(f"Chrome Extension Connected! Mode: {mode}")

    # Select the runner based on mode
    active_runner = shield_runner if mode == "shield" else talk_runner

    # Register WebSocket so tool functions can send actions to the extension
    set_websocket(websocket)

    # Generate unique IDs for this session
    user_id = f"user-{uuid.uuid4().hex[:8]}"
    session_id = f"session-{uuid.uuid4().hex[:8]}"

    # ════════════════════════════════════════
    # Phase 2: Session Initialization
    # ════════════════════════════════════════

    run_config = RunConfig(
        streaming_mode=StreamingMode.BIDI,
        response_modalities=[types.Modality.AUDIO],
        input_audio_transcription=types.AudioTranscriptionConfig(),
        output_audio_transcription=types.AudioTranscriptionConfig(),
    )

    # Create session
    await session_service.create_session(
        app_name=APP_NAME,
        user_id=user_id,
        session_id=session_id,
    )

    # Create LiveRequestQueue — the bridge between WebSocket and ADK
    live_request_queue = LiveRequestQueue()

    # Register the queue with tools so the audio gate can flush buffered audio
    set_live_queue(live_request_queue)

    print(f"ADK session created: {session_id}")

    # ════════════════════════════════════════
    # Phase 3: Bidi-streaming
    # ════════════════════════════════════════

    async def upstream_task() -> None:
        """Receives audio/screenshot from WebSocket → sends to ADK LiveRequestQueue."""
        chunk_count = 0
        try:
            while True:
                message = await websocket.receive()

                if message.get("type") == "websocket.disconnect":
                    break

                # Binary data = audio PCM chunk
                if "bytes" in message and message["bytes"]:
                    raw_bytes = message["bytes"]
                    chunk_count += 1
                    if chunk_count % 500 == 1:
                        print(f"🎤 Receiving audio... ({chunk_count} chunks)")

                    audio_blob = types.Blob(
                        mime_type="audio/pcm;rate=16000",
                        data=raw_bytes,
                    )

                    # Audio gate: DROP audio during tool execution to prevent 1008/1007 crash
                    if not is_audio_paused():
                        live_request_queue.send_realtime(audio_blob)

                # Text data = JSON (screenshot, action results, ping, etc.)
                elif "text" in message and message["text"]:
                    data = json.loads(message["text"])

                    if data.get("type") == "ping":
                        # Just a heartbeat to keep the connection alive
                        continue

                    if data.get("type") == "screenshot":
                        b64_data = data["data"].split(",")[1]
                        image_bytes = base64.b64decode(b64_data)

                        image_blob = types.Blob(
                            mime_type="image/jpeg",
                            data=image_bytes,
                        )

                        # Send a text prompt with the screenshot via send_content
                        content = types.Content(
                            parts=[
                                types.Part(text="What is this?"),
                                types.Part(inline_data=image_blob)
                            ]
                        )
                        live_request_queue.send_content(content)

                    elif data.get("type") == "action_result":
                        # Extension completed a tool action — resolve the pending future
                        action_id = data.get("actionId")
                        result = data.get("result", {})

                        # Handle playback instructions injected from UI library
                        if action_id == "PLAYBACK" and "playback_instruction" in result:
                            instruction = result["playback_instruction"]
                            print(f"▶️ Injecting conversational playback: {instruction[:50]}...")
                            conversational_prompt = f"""
                            The user has just triggered a stored automation. 
                            
                            INSTRUCTIONS:
                            1. Briefly acknowledge the task to the user (e.g., "Got it, I'll start [Task] for you now...").
                            2. Access the content of the workflow below.
                            3. Carry out the instructions naturally using your browser tools.
                            4. Continue to be helpful and conversational throughout the process.
                            
                            WORKFLOW CONTENT:
                            {instruction}
                            """
                            content = types.Content(
                                parts=[types.Part(text=conversational_prompt.strip())]
                            )
                            live_request_queue.send_content(content)
                            continue

                        if action_id:
                            resolve_action(action_id, result)
                            print(f"✅ Action {action_id} resolved: {result.get('success')}")

        except WebSocketDisconnect:
            print("Extension disconnected.")
        except Exception as e:
            print(f"Upstream error: {e}")

    async def downstream_task() -> None:
        """Receives ADK Events from run_live() → sends to WebSocket."""
        try:
            async for event in active_runner.run_live(
                user_id=user_id,
                session_id=session_id,
                live_request_queue=live_request_queue,
                run_config=run_config,
            ):
                # Extract audio data from the event and send to extension
                if event.content and event.content.parts:
                    for part in event.content.parts:
                        if part.inline_data and part.inline_data.data:
                            audio_b64 = base64.b64encode(part.inline_data.data).decode("utf-8")
                            await websocket.send_text(
                                json.dumps({"type": "audio", "data": audio_b64})
                            )

                # Handle interruption (barge-in)
                if event.interrupted:
                    print("⚡ Gemini was interrupted (barge-in)")
                    await websocket.send_text(
                        json.dumps({"type": "interrupted"})
                    )

                # Handle turn complete
                if event.turn_complete:
                    print("Gemini turn complete, listening...")
                    await websocket.send_text(
                        json.dumps({"type": "turn_complete"})
                    )

        except WebSocketDisconnect:
            print("Extension disconnected (downstream).")
        except Exception as e:
            print(f"⚠️ Downstream error: {e}")
            # Try to notify the extension so it doesn't hang
            try:
                await websocket.send_text(
                    json.dumps({"type": "turn_complete"})
                )
            except Exception:
                pass
            # If the session dies, the tasks will finish and the WS will close cleanly.

    # Run both tasks concurrently
    try:
        await asyncio.gather(
            upstream_task(),
            downstream_task(),
            return_exceptions=True,
        )
    finally:
        # ════════════════════════════════════════
        # Phase 4: Session Termination
        # ════════════════════════════════════════
        clear_websocket()
        set_live_queue(None)
        live_request_queue.close()
        print(f"Session {session_id} closed.")


# ════════════════════════════════════════
# Health check
# ════════════════════════════════════════

@app.get("/health")
async def health():
    return {"status": "ok", "agent": root_agent.name}

class ScanRequest(BaseModel):
    url: str
    title: str
    elements: list

@app.post("/api/scan")
async def scan_page(req: ScanRequest):
    client = genai.Client()
    elements_text = "\n".join([f"<{el.get('tag', '')} text='{el.get('text', '')}' href='{el.get('href', '')}'>" for el in req.elements[:100]])
    
    prompt = f"""
    Analyze this webpage for scam or phishing risks.
    URL: {req.url}
    Title: {req.title}
    Elements Snapshot:
    {elements_text}
    
    Return a JSON object ONLY, with the following format:
    {{
        "risk_score": <number 0-100, 100 being extreme scam/phishing risk>,
        "reasoning": "<short explanation why>"
    }}
    """
    try:
        response = client.models.generate_content(
            model='gemini-2.5-flash',
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                temperature=0.2
            )
        )
        data = json.loads(response.text)
        return data
    except Exception as e:
        print(f"Scan error: {e}")
        return {"risk_score": 0, "reasoning": f"Failed to analyze risk: {e}"}


@app.get("/api/workflows")
async def list_workflows():
    """List all saved instruction files in the workflows directory."""
    try:
        root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
        workflows_dir = os.path.join(root_dir, "workflows")
        if not os.path.exists(workflows_dir):
            return {"workflows": []}
            
        files = glob.glob(os.path.join(workflows_dir, "*.md"))
        workflow_list = []
        for f in files:
            name = os.path.basename(f)
            # Try to read the description from frontmatter
            desc = name
            try:
                with open(f, 'r', encoding='utf-8') as wf:
                    content = wf.read()
                    if content.startswith('---'):
                        parts = content.split('---', 2)
                        if len(parts) >= 3:
                            for line in parts[1].split('\n'):
                                if line.startswith('description:'):
                                    desc = line.split(':', 1)[1].strip()
            except:
                pass
            workflow_list.append({"filename": name, "description": desc})
        
        return {"workflows": workflow_list}
    except Exception as e:
        return {"error": str(e)}

@app.get("/api/workflows/{filename}")
async def get_workflow(filename: str):
    """Read specific workflow content."""
    try:
        root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
        file_path = os.path.join(root_dir, "workflows", filename)
        if not os.path.exists(file_path):
            return {"error": "Not found"}
            
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
            # Remove frontmatter if present
            if content.startswith('---'):
                parts = content.split('---', 2)
                if len(parts) >= 3:
                    content = parts[2].strip()
            
        return {"content": content}
    except Exception as e:
        return {"error": str(e)}

@app.delete("/api/workflows/{filename}")
async def delete_workflow(filename: str):
    """Delete a workflow file."""
    try:
        root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
        file_path = os.path.join(root_dir, "workflows", filename)
        if os.path.exists(file_path):
            os.remove(file_path)
            return {"success": True}
        return {"error": "File not found"}
    except Exception as e:
        return {"error": str(e)}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="localhost", port=8080, reload=True)
