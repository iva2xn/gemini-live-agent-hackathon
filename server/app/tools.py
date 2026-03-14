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
        
        # ACTUALLY FIX THE LIMIT HERE:
        # The AI (Brain) calls this function in a fast loop to execute browser actions.
        # By pausing for exactly 2 seconds AFTER each action, we force the AI to wait.
        # This keeps the total Requests Per Minute under 30 (well below the Vertex limit of 60/15).
        print(f"⏱️ Throttling brain for 2 seconds to respect Vertex RPM limits...")
        await asyncio.sleep(2.0)
        
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

# ════════════════════════════════════════
# Macro Recording State
# ════════════════════════════════════════

MACROS_FILE = "macros.json"

def load_macros():
    if os.path.exists(MACROS_FILE):
        try:
            with open(MACROS_FILE, "r") as f:
                return json.load(f)
        except:
            pass
    return {}

def save_macros(macros):
    with open(MACROS_FILE, "w") as f:
        json.dump(macros, f, indent=2)

_macro_recorder = {
    "recording": False,
    "goal": None,
    "actions": [],
    "element_map": {}
}

def _update_recorder(res, action_dict=None):
    """Helper to record an action and extract selectors from updated elements."""
    if _macro_recorder["recording"] and res.get("success"):
        if action_dict:
            _macro_recorder["actions"].append(action_dict)
        
        elements = res.get("elements") or res.get("updatedElements")
        if elements:
            for el in elements:
                if "id" in el and "selector" in el:
                    _macro_recorder["element_map"][el["id"]] = el["selector"]


# ════════════════════════════════════════
# ADK Tool Functions (called by Gemini)
# ════════════════════════════════════════

async def get_page_elements() -> dict:
    """Get all interactive elements visible on the current webpage.

    Returns the page URL, title, and a list of elements.
    Each element has a unique nibo_id you can use with click_element or type_text.
    Always call this BEFORE your first action on a new page.
    """
    res = await _send_action("get_elements")
    _update_recorder(res)
    return res


async def click_element(nibo_id: str) -> dict:
    """Click a button, link, or other interactive element on the webpage.

    The response includes the updated list of page elements so you can
    immediately chain the next action without calling get_page_elements again.

    Args:
        nibo_id: The element identifier from get_page_elements (e.g. "nibo-5").
    """
    res = await _send_action("click", {"niboId": nibo_id})
    selector = _macro_recorder["element_map"].get(nibo_id)
    action_dict = {"type": "macro_click", "selector": selector} if selector else None
    _update_recorder(res, action_dict)
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
    selector = _macro_recorder["element_map"].get(nibo_id)
    action_dict = {"type": "macro_type", "selector": selector, "text": text} if selector else None
    _update_recorder(res, action_dict)
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
    _update_recorder(res, {"type": "press_key", "key": key})
    return res


async def scroll_page(direction: str) -> dict:
    """Scroll the page to reveal more elements.

    Use this when you can't find an element — it may be below the fold.
    The response includes the updated list of visible elements.

    Args:
        direction: Either "up" or "down".
    """
    res = await _send_action("scroll", {"direction": direction})
    _update_recorder(res, {"type": "scroll", "direction": direction})
    return res


async def navigate_to_url(url: str) -> dict:
    """Navigate the browser to a URL.

    After navigation completes, call get_page_elements to see the new page.

    Args:
        url: Full URL (e.g. "https://google.com") or relative path (e.g. "/settings").
    """
    res = await _send_action("navigate", {"url": url})
    _update_recorder(res, {"type": "navigate", "url": url})
    return res


async def start_macro(goal: str) -> dict:
    """Start recording a macro for a repeated task.
    
    Use this if the user asks you to 'remember' how to do something or if it's a routine task.
    
    Args:
        goal: A clear name for this macro (e.g., "Check Gmail", "Play LoFi on YouTube").
    """
    _macro_recorder["recording"] = True
    _macro_recorder["goal"] = goal
    _macro_recorder["actions"] = []
    _macro_recorder["element_map"] = {}
    return {"success": True, "message": f"Macro recording started for: {goal}"}


async def finish_macro(summary: str) -> dict:
    """Stop recording and save the macro.
    
    Args:
        summary: A quick summary of what the macro does.
    """
    if not _macro_recorder["recording"]:
        return {"success": False, "error": "No macro recording in progress."}
        
    goal = _macro_recorder["goal"]
    if _macro_recorder["actions"]:
        macros = load_macros()
        macros[goal] = _macro_recorder["actions"]
        save_macros(macros)
        print(f"💾 Macro saved for goal: '{goal}'")
        
    _macro_recorder["recording"] = False
    return {"success": True, "message": f"Macro '{goal}' saved successfully. {summary}"}


async def playback_macro(goal: str) -> dict:
    """Execute a previously saved macro instantly.
    
    Args:
        goal: The exact name of the macro to play.
    """
    macros = load_macros()
    if goal not in macros:
        return {"success": False, "error": f"Macro '{goal}' not found."}
        
    print(f"🚀 Playing macro: '{goal}'")
    for action in macros[goal]:
        action_type = action["type"]
        params = {}
        if action_type == "macro_click":
            params = {"selector": action["selector"]}
        elif action_type == "macro_type":
            params = {"selector": action["selector"], "text": action["text"]}
        elif action_type == "press_key":
            params = {"key": action["key"]}
        elif action_type == "scroll":
            params = {"direction": action["direction"]}
        elif action_type == "navigate":
            params = {"url": action["url"]}
            
        res = await _send_action(action_type, params)
        if not res.get("success"):
            return {"success": False, "error": f"Macro failed at {action_type}: {res.get('error')}"}
            
    return {"success": True, "message": f"Macro '{goal}' executed successfully."}


async def save_context(info: str) -> dict:
    """Save important information to the conversation memory for later use.
    
    Call this when the user says something important (e.g., their name, details for an email).
    
    Args:
        info: The information to save.
    """
    conversation_memory.append({"role": "user_context", "info": info})
    return {"success": True, "message": "Context saved to global memory."}