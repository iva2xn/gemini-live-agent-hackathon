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

# ════════════════════════════════════════
# Shared session state (set by main.py)
# ════════════════════════════════════════

_session_state = {
    "websocket": None,
    "pending_actions": {},  # action_id → asyncio.Future
}

# ════════════════════════════════════════
# Audio Gate — prevents 1008 crash during tool execution
# ════════════════════════════════════════
# When Gemini calls a tool, it stops accepting sendRealtimeInput (audio).
# If audio is sent during this window, the API returns 1008 and kills the session.
# The gate tells upstream_task to buffer audio instead of sending it.
# After the tool completes, we wait briefly for ADK to send the tool response,
# then flush the buffer so Gemini gets all the audio with minimal delay.

_audio_gate = {
    "paused": False,
    "buffer": [],      # List of (mime_type, data) tuples to replay
    "queue": None,     # Reference to LiveRequestQueue, set by main.py
}

_TOOL_RESPONSE_GRACE = 0.15  # seconds to wait after tool returns for ADK to send tool_response


def set_live_queue(queue):
    """Register the LiveRequestQueue so we can flush buffered audio."""
    _audio_gate["queue"] = queue


def is_audio_paused():
    """Check if audio should be buffered (tool in progress)."""
    return _audio_gate["paused"]


def buffer_audio_blob(blob):
    """Buffer an audio blob during tool execution."""
    _audio_gate["buffer"].append(blob)


def _pause_audio():
    """Pause realtime audio sending (called when tool starts)."""
    _audio_gate["paused"] = True
    print("⏸️  Audio gate CLOSED (tool in progress)")


async def _resume_audio():
    """Resume audio and flush buffer (called after tool completes)."""
    # Wait for ADK to finish sending the tool_response to Gemini
    await asyncio.sleep(_TOOL_RESPONSE_GRACE)

    queue = _audio_gate["queue"]
    buffered = _audio_gate["buffer"]
    if queue and buffered:
        print(f"▶️  Audio gate OPEN — flushing {len(buffered)} buffered chunks")
        for blob in buffered:
            queue.send_realtime(blob)
    else:
        print("▶️  Audio gate OPEN — no buffered audio")

    _audio_gate["buffer"] = []
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
    """Send an action to the extension and wait for the result.
    """
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