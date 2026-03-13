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


async def update_voice_agent(message: str) -> dict:
    """Send a status update conversational prompt back to the Voice Agent and the User.
    
    Call this tool occasionally during long tasks (e.g. after navigating, or when stuck).
    Tell the Voice Agent what you are doing so it can relay it naturally to the user.
    Example message: "Tell the user we have reached YouTube and I'm currently looking for the search bar."
    
    Args:
        message: The status update you want the Voice Agent to relay to the user.
    """
    # Simply appending to the memory is often enough to steer the voice agent implicitly if it checks memory, 
    # but the Voice agent might not speak unprompted in Live API unless the loop is specific. 
    # For now, appending to memory allows the Brain to drop breadcrumbs.
    conversation_memory.append({"role": "brain_status_update", "text": message})
    return {"success": True, "message": "Voice agent updated."}


async def _run_brain_process(goal: str, task_id: str, future_for_first_voice_response=None):
    """The internal background loop."""
    print(f"🎬 [Brain {task_id}] Started background goal: {goal}")
    _macro_recorder["recording"] = True
    _macro_recorder["goal"] = goal
    _macro_recorder["actions"] = []
    _macro_recorder["element_map"] = {}
    try:
        client = genai.Client()
        brain_tools = [
            get_page_elements,
            click_element,
            type_text,
            press_key,
            scroll_page,
            navigate_to_url,
            update_voice_agent,
        ]
        
        system_instruction = f"""\
You are NIBO Brain, an autonomous background browser agent.
Your objective is to achieve the user's goal by interacting with the browser.
Goal: {goal}

Context of previous interactions:
{conversation_memory}

- You are driving the browser. You have tools to get elements, click, type, navigate, and scroll.
- You do NOT have a voice. Do NOT try to converse directly.
- The Voice Agent is talking to the user on your behalf.
- **CRITICAL**: Use the `update_voice_agent` tool to periodically drop status updates (e.g. "I am looking for the search bar", "I'm navigating to the page"). The Voice agent will use these to tell the user what's going on.
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
        response = await chat.send_message("Acknowledge the goal, tell the Voice agent your first step via normal text response, and begin.")
        
        result_text = response.text or "Goal executed."
        print(f"✅ [Brain {task_id}] Finished: {result_text}")
        
        if future_for_first_voice_response and not future_for_first_voice_response.done():
            future_for_first_voice_response.set_result(result_text)
            
        # Save macro
        if _macro_recorder["actions"]:
            macros = load_macros()
            macros[goal] = _macro_recorder["actions"]
            save_macros(macros)
            print(f"💾 Macro saved for goal: '{goal}'")
            
        conversation_memory.append({"role": "brain", "text": f"Completed: {goal}. Result: {result_text}"})
    except Exception as e:
        print(f"❌ [Brain {task_id}] Failed: {e}")
        traceback.print_exc()
        if future_for_first_voice_response and not future_for_first_voice_response.done():
            future_for_first_voice_response.set_result(f"Error starting: {e}")
        conversation_memory.append({"role": "brain", "error": str(e)})
    finally:
        _macro_recorder["recording"] = False


async def process_browser_task(goal: str) -> dict:
    """Execute a complex browser task in the background using a smarter model.

    Call this tool whenever the user asks you to do something in the browser 
    (e.g., "reset password", "message John", "search for a youtube video", "scroll down"). 
    You will hand off the goal to the NIBO Brain, which will silently drive the browser.
    
    WARNING: THIS TOOL WILL TAKE A FEW SECONDS TO RETURN. 
    It returns the initial plan of the Brain. You MUST use this return value to 
    provide a natural, conversational update to the user about what the Brain has decided to do.

    Args:
        goal: The precise details of the user's request.
    """
    task_id = uuid.uuid4().hex[:6]
    conversation_memory.append({"role": "user", "text": goal})
    
    # Check for Macros first!
    macros = load_macros()
    if goal in macros:
        print(f"🚀 [Brain {task_id}] Macro found! Attempting zero-shot playback for: '{goal}'")
        
        async def play_macro():
            macro_success = True
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
                    print(f"⚠️ [Brain {task_id}] Macro playback failed at {action_type}: {res.get('error')}")
                    macro_success = False
                    break
                    
            if macro_success:
                print(f"✅ [Brain {task_id}] Macro playback successful!")
                conversation_memory.append({"role": "brain", "text": f"Instant Macro Execution Completed: {goal}"})
            else:
                print(f"🔄 [Brain {task_id}] Falling back to normal background execution...")
                await _run_brain_process(goal, task_id)
                
        # Fire and forget playback
        task = asyncio.create_task(play_macro())
        _active_background_tasks[task_id] = task
        return {
            "success": True, 
            "message": f"I found a saved macro for '{goal}' and am executing it instantly right now!"
        }

    # Since `send_message` blocks until the tool loop finishes, we will use a Future 
    # to grab the first chunk/response, or we just let it run async and return a generic
    # message that the Brain is navigating.
    # To TRULY stream it, we should make a custom loop. For simplicity, we fire the task
    # and return a dynamic response.
    task = asyncio.create_task(_run_brain_process(goal, task_id))
    _active_background_tasks[task_id] = task
    
    return {
        "success": True, 
        "message": f"The Brain has successfully received the goal '{goal}' and is launching the browser automation. It is currently looking at the page layout to find out what to do."
    }


async def save_context(info: str) -> dict:
    """Save important information to the conversation memory for later use.
    
    Call this when the user says something important (e.g., their name, details for an email).
    
    Args:
        info: The information to save.
    """
    conversation_memory.append({"role": "user_context", "info": info})
    return {"success": True, "message": "Context saved to global memory."}