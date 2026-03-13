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

_TOOL_RESPONSE_GRACE = 0.5  # seconds for ADK to finish sending the tool_response


def set_live_queue(queue):
    """Register the LiveRequestQueue."""
    _audio_gate["queue"] = queue


def is_audio_paused():
    """Check if audio should be dropped (tool in progress)."""
    return _audio_gate["paused"]


def _pause_audio():
    """Pause realtime audio sending (called when tool starts)."""
    _audio_gate["paused"] = True


async def _resume_audio():
    """Resume audio sending (called after tool completes)."""
    # Wait for ADK to finish sending the tool_response to Gemini
    await asyncio.sleep(_TOOL_RESPONSE_GRACE)
    _audio_gate["paused"] = False


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


# ════════════════════════════════════════
# ADK Tool Functions (called by Gemini)
# ════════════════════════════════════════

async def get_page_elements() -> dict:
    """Get all interactive elements visible on the current webpage.

    Returns the page URL, title, and a list of elements.
    Each element has a unique nibo_id you can use with click_element or type_text.
    Always call this BEFORE your first action on a new page.
    """
    return await _send_action("get_elements")


async def click_element(nibo_id: str) -> dict:
    """Click a button, link, or other interactive element on the webpage.

    The response includes the updated list of page elements so you can
    immediately chain the next action without calling get_page_elements again.

    Args:
        nibo_id: The element identifier from get_page_elements (e.g. "nibo-5").
    """
    return await _send_action("click", {"niboId": nibo_id})


async def type_text(nibo_id: str, text: str) -> dict:
    """Type text into an input field or textarea on the webpage.

    This replaces any existing text in the field.  The response includes
    the updated page elements so you can chain the next action immediately.

    Args:
        nibo_id: The element identifier from get_page_elements (e.g. "nibo-3").
        text: The text to type.
    """
    return await _send_action("type", {"niboId": nibo_id, "text": text})


async def press_key(key: str) -> dict:
    """Press a keyboard key on the currently focused element.

    Common uses: press Enter to submit a search or send a message,
    Tab to move focus, Escape to close a dialog.
    The response includes updated page elements.

    Args:
        key: The key to press. Supported: Enter, Tab, Escape, Backspace, ArrowDown, ArrowUp.
    """
    return await _send_action("press_key", {"key": key})


async def scroll_page(direction: str) -> dict:
    """Scroll the page to reveal more elements.

    Use this when you can't find an element — it may be below the fold.
    The response includes the updated list of visible elements.

    Args:
        direction: Either "up" or "down".
    """
    return await _send_action("scroll", {"direction": direction})


async def navigate_to_url(url: str) -> dict:
    """Navigate the browser to a URL.

    After navigation completes, call get_page_elements to see the new page.

    Args:
        url: Full URL (e.g. "https://google.com") or relative path (e.g. "/settings").
    """
    return await _send_action("navigate", {"url": url})


# ════════════════════════════════════════
# Background Brain (gemini-3.1-flash)
# ════════════════════════════════════════

async def _run_brain_process(goal: str, task_id: str):
    """The internal background loop."""
    print(f"🎬 [Brain {task_id}] Started background goal: {goal}")
    try:
        client = genai.Client()
        brain_tools = [
            get_page_elements,
            click_element,
            type_text,
            press_key,
            scroll_page,
            navigate_to_url,
        ]
        
        system_instruction = f"""\
You are NIBO Brain, an autonomous background browser agent.
Your objective is to achieve the user's goal by interacting with the browser.
Goal: {goal}

Context of previous interactions:
{conversation_memory}

- You are driving the browser. You have tools to get elements, click, type, navigate, and scroll.
- You do NOT have a voice. Do NOT try to converse.
- Your entire existence is a loop of checking the page (get_page_elements) and interacting.
- If an element is found by ID, use click_element or type_text.
- Feel perfectly comfortable navigating to direct URLs (e.g. facebook.com, gmail.com/reset) instead of Googling everything.
- When you consider the goal complete, simply return text summarizing what was accomplished.
"""
        
        chat = client.aio.chats.create(
            model="gemini-2.5-flash",
            config=types.GenerateContentConfig(
                system_instruction=system_instruction,
                temperature=0.0,
                tools=brain_tools,
            )
        )
        
        # Start the automated tool execution loop inside the google-genai SDK
        response = await chat.send_message("Please execute the goal now.")
        
        result_text = response.text or "Goal executed."
        print(f"✅ [Brain {task_id}] Finished: {result_text}")
        conversation_memory.append({"role": "brain", "text": f"Completed: {goal}. Result: {result_text}"})
    except Exception as e:
        print(f"❌ [Brain {task_id}] Failed: {e}")
        traceback.print_exc()
        conversation_memory.append({"role": "brain", "error": str(e)})


async def process_browser_task(goal: str) -> dict:
    """Execute a complex browser task in the background using a smarter model.

    Call this tool whenever the user asks you to do something in the browser 
    (e.g., "reset password", "message John", "search for a youtube video", "scroll down"). 
    You will hand off the goal to the NIBO Brain, which will silently drive the browser.

    Args:
        goal: The precise details of the user's request.
    """
    task_id = uuid.uuid4().hex[:6]
    conversation_memory.append({"role": "user", "text": goal})
    
    # We run the background brain without blocking the voice agent
    task = asyncio.create_task(_run_brain_process(goal, task_id))
    _active_background_tasks[task_id] = task
    
    return {
        "success": True, 
        "message": f"Handoff complete. NIBO Brain is now working on '{goal}' in the background. Tell the user you've started."
    }


async def save_context(info: str) -> dict:
    """Save important information to the conversation memory for later use.
    
    Call this when the user says something important (e.g., their name, details for an email).
    
    Args:
        info: The information to save.
    """
    conversation_memory.append({"role": "user_context", "info": info})
    return {"success": True, "message": "Context saved to global memory."}