"""
NIBO Browser Tools — ADK tool functions for browser automation.

These tools are called by Gemini via ADK when the user requests browser actions.
They communicate with the Chrome extension via a shared WebSocket reference.

Flow:  Gemini → ADK calls tool function → WebSocket → extension → result → ADK → Gemini

LATENCY NOTE: click_element, type_text, and press_key all return refreshed
page elements alongside the action result.  This lets Gemini chain actions
without making a separate get_page_elements call in between.
"""

import asyncio
import json
import traceback
import uuid
from google import genai
from google.genai import types

# Global shared conversation memory
conversation_memory = []
_active_background_tasks = {}

# ════════════════════════════════════════
# Shared session state (set by main.py)
# ════════════════════════════════════════

_session_state = {
    "websocket": None,
    "pending_actions": {},  # action_id → asyncio.Future
}

# ════════════════════════════════════════
# Audio Gate — prevents 1008/1007 crash during tool execution
# ════════════════════════════════════════
# When Gemini calls a tool, it currently rejects sendRealtimeInput (audio)
# natively in the protocol until the tool response is returned.

_audio_gate = {
    "paused": False,
    "queue": None,     # Reference to LiveRequestQueue, set by main.py
}

_TOOL_RESPONSE_GRACE = 0.1  # seconds for ADK to finish sending the tool_response


def set_live_queue(queue):
    """Register the LiveRequestQueue."""
    _audio_gate["queue"] = queue


def is_audio_paused():
    """Check if audio should be dropped (tool in progress)."""
    return _audio_gate["paused"]


def _pause_audio():
    """No-op: disabled to allow 'fully listen' mode."""
    pass


async def _resume_audio():
    """No-op: disabled to allow 'fully listen' mode."""
    pass


def set_websocket(ws):
    """Register the active WebSocket (called when extension connects)."""
    _session_state["websocket"] = ws
    print(f"🔌 Tools: WebSocket registered (id={id(ws)})")


def clear_websocket():
    """Unregister the WebSocket (called on disconnect)."""
    _session_state["websocket"] = None
    print("🔌 Tools: WebSocket cleared")
    for future in _session_state["pending_actions"].values():
        if not future.done():
            future.cancel()
    _session_state["pending_actions"].clear()


def resolve_action(action_id: str, result: dict):
    """Resolve a pending action future (called when extension sends a result)."""
    future = _session_state["pending_actions"].pop(action_id, None)
    if future and not future.done():
        future.set_result(result)
        print(f"✅ Action {action_id} resolved")
    else:
        print(f"⚠️ Action {action_id}: no pending future found (may have timed out)")


# ════════════════════════════════════════
# Internal helper
# ════════════════════════════════════════

_ACTION_TIMEOUT = 15.0  # seconds — allow pages to load and tools to complete

async def _send_action(action_type: str, params: dict | None = None) -> dict:
    """Send an action to the extension and wait for the result."""
    _pause_audio()
    try:
        ws = _session_state["websocket"]
        print(f"🔧 Tool action: {action_type} | WebSocket={'connected' if ws else 'NONE'}")

        if not ws:
            return {
                "success": False,
                "error": "Browser not connected. The user needs to press Start Recording first.",
            }

        action_id = uuid.uuid4().hex[:8]
        loop = asyncio.get_running_loop()
        future = loop.create_future()
        _session_state["pending_actions"][action_id] = future

        await ws.send_text(json.dumps({
            "type": "action",
            "action_type": action_type,
            "actionId": action_id,
            "params": params or {},
        }))

        result = await asyncio.wait_for(future, timeout=_ACTION_TIMEOUT)
        
        # ACTUALLY FIX THE LIMIT HERE:
        # The AI (Brain) calls this function in a fast loop to execute browser actions.
        # By pausing for exactly 2 seconds AFTER each action, we force the AI to wait.
        # This keeps the total Requests Per Minute under 30 (well below the Vertex limit of 60/15).
        # Reduced throttling to 0.2s. Vertex AI limits are usually 60 RPM, 
        # so 0.2s is still very safe while being much more responsive.
        print(f"⏱️ Throttling brain for 0.2 seconds...")
        await asyncio.sleep(0.2)
        
        return result
    except asyncio.TimeoutError:
        _session_state["pending_actions"].pop(action_id, None)
        print(f"⏰ Action {action_type} timed out after {_ACTION_TIMEOUT}s")
        return {
            "success": False,
            "error": f"Action timed out after {_ACTION_TIMEOUT}s. The page may not have a content script — try a different tab.",
        }
    except Exception as e:
        print(f"❌ Tool error ({action_type}): {e}")
        traceback.print_exc()
        return {"success": False, "error": f"Tool error: {str(e)}"}
    finally:
        await _resume_audio()


import os

async def get_page_elements() -> dict:
    """Get all interactive elements visible on the current webpage.

    Returns the page URL, title, and a list of elements.
    Each element has a unique nibo_id you can use with click_element or type_text.
    Always call this BEFORE your first action on a new page.
    """
    res = await _send_action("get_elements")
    return res


async def click_element(nibo_id: str) -> dict:
    """Click a button, link, or other interactive element on the webpage.

    The response includes the updated list of page elements so you can
    immediately chain the next action without calling get_page_elements again.

    Args:
        nibo_id: The element identifier from get_page_elements (e.g. "nibo-5").
    """
    res = await _send_action("click", {"niboId": nibo_id})
    return res


async def type_text(nibo_id: str, text: str) -> dict:
    """Type text into an input field or textarea on the webpage.

    This replaces any existing text in the field.  The response includes
    the updated page elements so you can chain the next action immediately.

    Args:
        nibo_id: The element identifier from get_page_elements (e.g. "nibo-3").
        text: The text to type.
    """
    res = await _send_action("type", {"niboId": nibo_id, "text": text})
    return res


async def press_key(key: str) -> dict:
    """Press a keyboard key on the currently focused element.

    Common uses: press Enter to submit a search or send a message,
    Tab to move focus, Escape to close a dialog.
    The response includes updated page elements.

    Args:
        key: The key to press. Supported: Enter, Tab, Escape, Backspace, ArrowDown, ArrowUp.
    """
    res = await _send_action("press_key", {"key": key})
    return res


async def scroll_page(direction: str) -> dict:
    """Scroll the page to reveal more elements.

    Use this when you can't find an element — it may be below the fold.
    The response includes the updated list of visible elements.

    Args:
        direction: Either "up" or "down".
    """
    res = await _send_action("scroll", {"direction": direction})
    return res


async def navigate_to_url(url: str) -> dict:
    """Navigate the browser to a URL.

    After navigation completes, call get_page_elements to see the new page.

    Args:
        url: Full URL (e.g. "https://google.com") or relative path (e.g. "/settings").
    """
    res = await _send_action("navigate", {"url": url})
    return res


MEMORY_FILE = "memory.json"

def load_memory():
    if os.path.exists(MEMORY_FILE):
        try:
            with open(MEMORY_FILE, "r") as f:
                return json.load(f)
        except:
            pass
    return []

def save_memory(memory):
    with open(MEMORY_FILE, "w") as f:
        json.dump(memory, f, indent=2)


async def get_memory() -> dict:
    """Retrieve all previously saved facts, preferences, and context.
    
    Use this if you feel you've forgotten a detail the user told you earlier.
    """
    memory = load_memory()
    return {"success": True, "memory": memory}


async def save_context(info: str) -> dict:
    """Save important information to the persistent memory for later use.
    
    Call this when the user says something important (e.g., their name, details for an email, 
    or a specific message they want you to remember).
    
    Args:
        info: The information to save.
    """
    memory = load_memory()
    memory.append({"role": "user_context", "info": info, "timestamp": str(asyncio.get_event_loop().time())})
    save_memory(memory)
    return {"success": True, "message": "Context saved to persistent memory."}


async def report_scam_risk(risk_score: int, reasoning: str, detected_scam_type: str) -> dict:
    """Report a detected scam or risk from the audio conversation.
    
    Use this ONLY when you detect a potential scam or risk in the conversation.
    The report will be shown to the user in the extension UI.
    
    Args:
        risk_score: A number from 0-100 indicating the risk level. 100 is extreme risk.
        reasoning: A short explanation of why this is considered a scam.
        detected_scam_type: The type of scam (e.g., "Tech Support", "Bank Fraud", "Impersonation").
    """
    ws = _session_state["websocket"]
    if not ws:
        return {"success": False, "error": "WebSocket not connected."}
        
    await ws.send_text(json.dumps({
        "type": "update_risk",
        "action": "UPDATE_RISK",
        "riskScore": risk_score,
        "reasoning": reasoning,
        "scamType": detected_scam_type,
        "isAudioRisk": True
    }))
    
    return {"success": True, "message": f"Scam risk of {risk_score} reported."}


async def create_workflow(name: str, steps_markdown: str) -> dict:
    """Create or update a reusable workflow file from safe user instructions.
    
    If a workflow with the same name already exists, the new steps will be 
    appended to it to create a cohesive multi-step workflow.
    
    Args:
        name: A descriptive name (e.g., "gmail_reset").
        steps_markdown: The raw markdown content of the workflow steps.
    """
    try:
        # 1. Use AI to clean up and improve the Markdown steps
        client = genai.Client()
        cleanup_prompt = f"""
        Improve and polish the following browser automation steps to be professional, 
        clear, and well-structured for an AI agent to execute.
        
        Rules:
        - Convert muddled or verbal instructions into a clean, numbered list.
        - Use direct, authoritative language (e.g., "1. Navigate to...", "2. Search for...").
        - Remove verbal fillers, conversational chatter, or redundant corrections.
        - Ensure the output is strictly Markdown.
        
        Task Intent: {name}
        Raw Steps Overheard:
        {steps_markdown}
        
        Return ONLY the polished Markdown steps. No chatter.
        """
        
        try:
            response = client.models.generate_content(
                model='gemini-2.0-flash',
                contents=cleanup_prompt,
                config=types.GenerateContentConfig(temperature=0.2)
            )
            polished_markdown = response.text.strip()
        except Exception as ai_err:
            print(f"⚠️ MD Polishing AI failed: {ai_err}")
            polished_markdown = steps_markdown

        # Create workflows directory in project root if it doesn't exist
        root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
        workflows_dir = os.path.join(root_dir, "workflows")
        os.makedirs(workflows_dir, exist_ok=True)
        
        # Normalize name for filename
        safe_name = name.lower().replace(' ', '_')
        filename = f"{safe_name}.md"
        file_path = os.path.join(workflows_dir, filename)
        
        exists = os.path.exists(file_path)
        mode = "a" if exists else "w"
        
        with open(file_path, mode, encoding='utf-8') as f:
            if not exists:
                f.write(f"---\ndescription: {name}\n---\n\n")
            else:
                f.write(f"\n\n### Additional Steps (Chained)\n")
            f.write(polished_markdown)
            
        print(f"📁 Workflow {'updated' if exists else 'created'}: {file_path}")
        return {"success": True, "message": f"Workflow {filename} {'appended' if exists else 'created'} successfully."}
    except Exception as e:
        print(f"❌ Error managing workflow: {e}")
        return {"success": False, "error": str(e)}