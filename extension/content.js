// NIBO Content Script — DOM Distillation & Action Execution
(function () {
    "use strict";

    let niboIdCounter = 0;
    const NIBO_ATTR = "data-nibo-id";
    const DOM_REFRESH_DELAY = 1000; // ms to wait after an action before re-distilling

    const INTERACTIVE_SELECTORS = [
        "button",
        "a[href]",
        'input:not([type="hidden"])',
        "textarea",
        "select",
        '[role="button"]',
        '[role="link"]',
        '[role="menuitem"]',
        '[role="tab"]',
        '[role="checkbox"]',
        '[role="radio"]',
        '[role="switch"]',
        '[role="textbox"]',
        '[role="searchbox"]',
        '[role="combobox"]',
        '[role="option"]',
        '[contenteditable="true"]',
    ];

    // ==========================================
    // VISIBILITY CHECK
    // ==========================================
    function isVisible(el) {
        const style = getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden") return false;
        if (parseFloat(style.opacity) === 0) return false;

        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return false;

        return true;
    }

    // ==========================================
    // DOM DISTILLATION
    // ==========================================
    function getElementText(el) {
        if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") return "";

        let text = "";
        for (const node of el.childNodes) {
            if (node.nodeType === Node.TEXT_NODE) text += node.textContent;
        }
        text = text.trim();
        if (!text) text = (el.innerText || "").trim();

        return text.substring(0, 120);
    }

    // Find the nearest visible label text for an element (form labels, nearby text)
    function getNearbyLabel(el) {
        // 1. Explicit <label for="...">
        if (el.id) {
            const label = document.querySelector(`label[for="${el.id}"]`);
            if (label) return label.textContent.trim().substring(0, 80);
        }
        // 2. Wrapping <label>
        const parentLabel = el.closest("label");
        if (parentLabel) {
            let t = "";
            for (const node of parentLabel.childNodes) {
                if (node.nodeType === Node.TEXT_NODE) t += node.textContent;
            }
            t = t.trim();
            if (t) return t.substring(0, 80);
        }
        // 3. Previous sibling text (common pattern: "Email: [input]")
        const prev = el.previousElementSibling;
        if (prev && (prev.tagName === "LABEL" || prev.tagName === "SPAN" || prev.tagName === "P")) {
            const t = prev.textContent.trim();
            if (t && t.length < 80) return t;
        }
        return "";
    }

    // Get the nearest section/group context for an element
    function getSectionContext(el) {
        // Walk up to find the nearest heading or landmark
        let node = el.parentElement;
        let depth = 0;
        while (node && depth < 8) {
            // Check for headings inside this container
            const heading = node.querySelector("h1, h2, h3, h4, [role='heading']");
            if (heading && heading !== el) {
                return heading.textContent.trim().substring(0, 60);
            }
            // Check for aria-label on container (e.g., <nav aria-label="Main">)
            const containerLabel = node.getAttribute("aria-label");
            if (containerLabel) return containerLabel.substring(0, 60);
            // Check for landmark roles
            const role = node.getAttribute("role");
            if (role && ["navigation", "main", "banner", "complementary", "dialog", "search", "form"].includes(role)) {
                return role;
            }
            node = node.parentElement;
            depth++;
        }
        return "";
    }

    // Helper to generate a unique, stable CSS selector for an element
    function generateSelector(el) {
        if (!el || el.nodeType !== 1) return "";
        let path = [];
        while (el && el.nodeType === 1 && el.tagName.toLowerCase() !== "html") {
            let selector = el.tagName.toLowerCase();
            if (el.id && !el.id.startsWith("nibo-")) {
                selector += `#${el.id}`;
                path.unshift(selector);
                break; // IDs are usually unique enough to stop
            } else {
                let sib = el, nth = 1;
                while (sib = sib.previousElementSibling) {
                    if (sib.tagName.toLowerCase() == selector) nth++;
                }
                if (nth != 1) selector += `:nth-of-type(${nth})`;
            }
            path.unshift(selector);
            el = el.parentNode;
        }
        return path.join(" > ");
    }

    // Distill the page down to just the interactive elements that Gemini needs to see
    function distillDOM() {
        // Clear old tags
        document.querySelectorAll(`[${NIBO_ATTR}]`).forEach((el) => {
            el.removeAttribute(NIBO_ATTR);
        });
        niboIdCounter = 0;

        const combined = INTERACTIVE_SELECTORS.join(", ");
        const allEls = document.querySelectorAll(combined);
        const distilled = [];
        const seen = new Set();

        for (const el of allEls) {
            if (seen.has(el) || !isVisible(el)) continue;
            seen.add(el);

            niboIdCounter++;
            const niboId = `nibo-${niboIdCounter}`;
            el.setAttribute(NIBO_ATTR, niboId);

            const entry = { id: niboId, tag: el.tagName, selector: generateSelector(el) };

            const text = getElementText(el);
            if (text) entry.text = text;

            const ariaLabel = el.getAttribute("aria-label");
            if (ariaLabel) entry.ariaLabel = ariaLabel;

            const placeholder = el.getAttribute("placeholder");
            if (placeholder) entry.placeholder = placeholder;

            const type = el.getAttribute("type");
            if (type) entry.type = type;

            const role = el.getAttribute("role");
            if (role) entry.role = role;

            const title = el.getAttribute("title");
            if (title) entry.title = title.substring(0, 80);

            // data-testid is excellent for identifying elements programmatically
            const testId = el.getAttribute("data-testid");
            if (testId) entry.testId = testId;

            if (el.tagName === "A") {
                const href = el.getAttribute("href");
                if (href && !href.startsWith("javascript:") && href !== "#") {
                    entry.href = href.substring(0, 100);
                }
            }

            if (
                el.tagName === "INPUT" ||
                el.tagName === "TEXTAREA" ||
                el.tagName === "SELECT"
            ) {
                if (el.value) entry.currentValue = el.value.substring(0, 50);

                // Nearby label gives crucial context for form fields
                const label = getNearbyLabel(el);
                if (label) entry.label = label;
            }

            if (el.disabled) entry.disabled = true;
            if (el.tagName === "INPUT" && el.type === "checkbox") {
                entry.checked = el.checked;
            }
            if (el.tagName === "INPUT" && el.type === "radio") {
                entry.checked = el.checked;
                if (el.name) entry.name = el.name;
            }

            // Section context helps Gemini understand WHERE on the page this element is
            const section = getSectionContext(el);
            if (section) entry.section = section;

            distilled.push(entry);
        }

        return distilled;
    }

    // Helper: returns the standard page-state metadata
    function pageState(extras) {
        return {
            url: window.location.href,
            title: document.title,
            ...extras,
        };
    }

    // ==========================================
    // ACTION EXECUTION
    // ==========================================
    function executeClick(niboId) {
        const el = document.querySelector(`[${NIBO_ATTR}="${niboId}"]`);
        if (!el) {
            return {
                success: false,
                error: `Element "${niboId}" not found. Call get_page_elements again.`,
            };
        }

        el.scrollIntoView({ behavior: "instant", block: "center" });

        const rect = el.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        const opts = {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX: x,
            clientY: y,
        };

        el.dispatchEvent(new PointerEvent("pointerdown", opts));
        el.dispatchEvent(new MouseEvent("mousedown", opts));
        el.dispatchEvent(new PointerEvent("pointerup", opts));
        el.dispatchEvent(new MouseEvent("mouseup", opts));
        el.dispatchEvent(new MouseEvent("click", opts));

        if (typeof el.focus === "function") el.focus();

        const label =
            el.innerText?.trim().substring(0, 40) ||
            el.getAttribute("aria-label") ||
            niboId;
        return { success: true, message: `Clicked "${label}"` };
    }

    async function executeType(niboId, text) {
        const el = document.querySelector(`[${NIBO_ATTR}="${niboId}"]`);
        if (!el) {
            return {
                success: false,
                error: `Element "${niboId}" not found. Call get_page_elements again.`,
            };
        }

        el.scrollIntoView({ behavior: "instant", block: "center" });
        el.focus();
        
        // Clear existing value if it's a standard input/textarea or contenteditable
        if (el.isContentEditable) {
            el.innerHTML = '';
        } else {
             // More robust clearing for React/Vue: use the native value setter
             const setter =
                Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set ||
                Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;

            if (setter) {
                setter.call(el, "");
            } else {
                el.value = "";
            }
        }
        
        // Trigger events to notify the page that the value has changed
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));

        // Dispatch key events for each character to trigger React/Rich text editor state
        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            const keyCode = char.charCodeAt(0);
            
            const keydownEvent = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: char, code: char, keyCode: keyCode });
            el.dispatchEvent(keydownEvent);

            if (el.isContentEditable) {
                // Ensure cursor is at the end for rich text editors
                const selection = window.getSelection();
                const range = document.createRange();
                range.selectNodeContents(el);
                range.collapse(false);
                selection.removeAllRanges();
                selection.addRange(range);

                if (!document.execCommand('insertText', false, char)) {
                   el.innerHTML += char;
                }
            } else {
                // Add character to standard input/textarea value
                const setter =
                    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set ||
                    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;

                if (setter) {
                    setter.call(el, el.value + char);
                } else {
                    el.value += char;
                }
            }

            const inputEvent = new InputEvent("input", { data: char, inputType: "insertText", bubbles: true, cancelable: true });
            el.dispatchEvent(inputEvent);

            const keyupEvent = new KeyboardEvent("keyup", { bubbles: true, cancelable: true, key: char, code: char, keyCode: keyCode });
            el.dispatchEvent(keyupEvent);

            // Tiny delay between characters to let the page's JS (React/Vue) process the state change
            await new Promise(r => setTimeout(r, 10));
        }
        
        // Final change event to signify completion
        el.dispatchEvent(new Event("change", { bubbles: true }));

        const label =
            el.getAttribute("aria-label") ||
            el.getAttribute("placeholder") ||
            niboId;
        return { success: true, message: `Typed "${text}" into "${label}"` };
    }

    function executeNavigate(url) {
        try {
            const resolved = new URL(url, window.location.href);
            window.location.href = resolved.href;
            return { success: true, message: `Navigating to ${resolved.href}` };
        } catch (e) {
            return { success: false, error: `Invalid URL: ${url}` };
        }
    }

    function executePressKey(key) {
        const el = document.activeElement || document.body;

        const opts = { key, code: key, bubbles: true, cancelable: true };
        if (key === "Enter") opts.keyCode = 13;
        else if (key === "Tab") opts.keyCode = 9;
        else if (key === "Escape") opts.keyCode = 27;
        else if (key === "Backspace") opts.keyCode = 8;

        el.dispatchEvent(new KeyboardEvent("keydown", opts));
        el.dispatchEvent(new KeyboardEvent("keypress", opts));
        el.dispatchEvent(new KeyboardEvent("keyup", opts));

        // For Enter on inputs inside forms, also submit the form
        if (key === "Enter" && el.form) {
            if (el.form.requestSubmit) {
                el.form.requestSubmit();
            } else {
                el.form.submit();
            }
        }

        const label =
            el.getAttribute("aria-label") ||
            el.getAttribute("placeholder") ||
            el.tagName;
        return { success: true, message: `Pressed ${key} on "${label}"` };
    }

    function executeScroll(direction) {
        const amount = direction === "up" ? -600 : 600;
        window.scrollBy({ top: amount, behavior: "instant" });
        return { success: true, message: `Scrolled ${direction}` };
    }

    // ==========================================
    // MACRO EXECUTION (By CSS Selector)
    // ==========================================
    function executeMacroClick(selector) {
        const el = document.querySelector(selector);
        if (!el) {
            return { success: false, error: `Macro failed: Element with selector "${selector}" not found.` };
        }
        // Temporarily assign a niboId to reuse executeClick logic
        const tempId = "nibo-macro-click";
        el.setAttribute(NIBO_ATTR, tempId);
        const result = executeClick(tempId);
        el.removeAttribute(NIBO_ATTR);
        return result;
    }

    async function executeMacroType(selector, text) {
        const el = document.querySelector(selector);
        if (!el) {
             return { success: false, error: `Macro failed: Element with selector "${selector}" not found.` };
        }
        const tempId = "nibo-macro-type";
        el.setAttribute(NIBO_ATTR, tempId);
        const result = await executeType(tempId, text);
        el.removeAttribute(NIBO_ATTR);
        return result;
    }


    // ==========================================
    // MESSAGE HANDLING (background.js ↔ content.js)
    // ==========================================
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        async function handleMessage() {
            if (message.action === "DISTILL_DOM") {
                const elements = distillDOM();
                sendResponse({
                    success: true,
                    elements,
                    elementCount: elements.length,
                    ...pageState(),
                });
            } else if (message.action === "EXECUTE_ACTION") {
                const { actionType, params } = message;
                let result;

                switch (actionType) {
                    case "click":
                        result = executeClick(params.niboId);
                        break;
                    case "type":
                        result = await executeType(params.niboId, params.text);
                        break;
                    case "macro_click":
                        result = executeMacroClick(params.selector);
                        break;
                    case "macro_type":
                        result = await executeMacroType(params.selector, params.text);
                        break;
                    case "press_key":
                        result = executePressKey(params.key);
                        break;
                    case "scroll":
                        result = executeScroll(params.direction);
                        break;
                    case "navigate":
                        result = executeNavigate(params.url);
                        sendResponse(result);
                        return;
                    default:
                        result = { success: false, error: `Unknown action: ${actionType}` };
                        sendResponse(result);
                        return;
                }

                setTimeout(() => {
                    const elements = distillDOM();
                    sendResponse({
                        ...result,
                        updatedElements: elements,
                        elementCount: elements.length,
                        ...pageState(),
                    });
                }, DOM_REFRESH_DELAY);
            }
        }

        handleMessage();
        return true; // Keep channel open
    });



    // ==========================================
    // FLOATING BUBBLE (NIBO Trigger)
    // ==========================================
    function injectNiboUI() {
        if (document.getElementById("nibo-bubble-host")) return;

        const host = document.createElement("div");
        host.id = "nibo-bubble-host";
        document.body.appendChild(host);

        const shadow = host.attachShadow({ mode: "open" });

        const styles = `
            :host {
                all: initial;
            }
            #bubble-container {
                position: fixed;
                bottom: 24px;
                right: 24px;
                z-index: 2147483647;
                display: flex;
                flex-direction: column;
                align-items: flex-end;
                pointer-events: none;
                transition: transform 0.1s ease-out;
            }
            #bubble-container.snapping {
                transition: all 0.5s cubic-bezier(0.19, 1, 0.22, 1);
            }
            #bubble {
                width: 56px;
                height: 56px;
                border-radius: 50%;
                background: #0052ff;
                box-shadow: 0 4px 12px rgba(0, 82, 255, 0.3), 
                            0 8px 14px rgba(0, 0, 0, 0.1);
                display: flex;
                align-items: center;
                justify-content: center;
                cursor: grab;
                transition: transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275), background 0.3s ease;
                border: 2px solid rgba(255, 255, 255, 0.2);
                padding: 0;
                pointer-events: auto;
                user-select: none;
                -webkit-user-drag: none;
            }
            #bubble:active {
                cursor: grabbing;
            }
            #bubble:hover {
                transform: scale(1.05);
            }
            svg {
                width: 28px;
                height: 28px;
                fill: white;
            }
            .tooltip {
                position: absolute;
                bottom: 100%;
                right: 0;
                margin-bottom: 12px;
                background: #1e1e2e;
                color: white;
                padding: 8px 14px;
                border-radius: 10px;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                font-size: 13px;
                font-weight: 500;
                white-space: nowrap;
                opacity: 0;
                visibility: hidden;
                transition: all 0.2s ease;
                transform: translateY(10px);
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
            }
            #bubble:hover:not(.dragging) + .tooltip {
                opacity: 1;
                visibility: visible;
                transform: translateY(0);
            }
        `;

        const html = `
            <div id="bubble-container">
                <div id="bubble" aria-label="Toggle NIBO">
                    <svg viewBox="0 0 24 24" id="bubble-icon">
                        <path d="M12,2A10,10 0 0,1 22,12A10,10 0 0,1 12,22A10,10 0 0,1 2,12A10,10 0 0,1 12,2M12,4A8,8 0 0,0 4,12C4,14.39 5.05,16.53 6.71,18L9.59,15.12C8.59,14.4 8,13.26 8,12A4,4 0 0,1 12,8A4,4 0 0,1 16,12C16,13.26 15.41,14.4 14.41,15.12L17.29,18C18.95,16.53 20,14.39 20,12A8,8 0 0,0 12,4M12,10A2,2 0 0,0 10,12A2,2 0 0,0 12,14A2,2 0 0,0 14,12A2,2 0 0,0 12,10Z" />
                    </svg>
                </div>
                <div class="tooltip">Toggle NIBO Side Panel</div>
            </div>
        `;

        const styleTag = document.createElement("style");
        styleTag.textContent = styles;
        shadow.appendChild(styleTag);

        const container = document.createElement("div");
        container.innerHTML = html;
        shadow.appendChild(container);

        const bubble = shadow.getElementById("bubble");
        const bubbleContainer = shadow.getElementById("bubble-container");

        let isDragging = false;
        let startX, startY;
        let currentX = 0, currentY = 0;
        let dragThreshold = 5;

        function toggle() {
             chrome.runtime.sendMessage({ action: "TOGGLE_SIDE_PANEL" });
        }

        // ==========================================
        // DRAG & SNAP LOGIC
        // ==========================================
        function onMouseDown(e) {
            startX = e.clientX - currentX;
            startY = e.clientY - currentY;
            isDragging = false;
            bubbleContainer.classList.remove("snapping");

            document.addEventListener("mousemove", onMouseMove);
            document.addEventListener("mouseup", onMouseUp);
        }

        function onMouseMove(e) {
            const deltaX = e.clientX - startX;
            const deltaY = e.clientY - startY;

            if (!isDragging && (Math.abs(deltaX - currentX) > dragThreshold || Math.abs(deltaY - currentY) > dragThreshold)) {
                isDragging = true;
                bubble.classList.add("dragging");
            }

            if (isDragging) {
                currentX = deltaX;
                currentY = deltaY;
                bubbleContainer.style.transform = `translate(${currentX}px, ${currentY}px)`;
            }
        }

        function onMouseUp() {
            document.removeEventListener("mousemove", onMouseMove);
            document.removeEventListener("mouseup", onMouseUp);

            if (!isDragging) {
                toggle();
            } else {
                snapToEdge();
            }
            
            setTimeout(() => {
                bubble.classList.remove("dragging");
                isDragging = false;
            }, 50);
        }

        function snapToEdge() {
            bubbleContainer.classList.add("snapping");
            
            const rect = bubble.getBoundingClientRect();
            const screenWidth = window.innerWidth;
            const screenHeight = window.innerHeight;
            const margin = 24;

            const isLeft = (rect.left + rect.width / 2) < (screenWidth / 2);
            const initialXRight = screenWidth - margin - rect.width;
            const targetX = isLeft ? -(initialXRight - margin) : 0;
            
            const initialYBottom = screenHeight - margin - rect.height;
            const bubbleTop = rect.top;
            const bubbleBottom = rect.bottom;
            
            let targetY = currentY;
            if (bubbleTop < margin) targetY = -(initialYBottom - margin);
            if (bubbleBottom > screenHeight - margin) targetY = 0;

            currentX = targetX;
            currentY = targetY;
            bubbleContainer.style.transform = `translate(${currentX}px, ${currentY}px)`;
        }

        bubble.addEventListener("mousedown", onMouseDown);

        window.addEventListener("resize", () => {
            if (currentX !== 0) snapToEdge();
        });

        // ==========================================
        // KEYBOARD SHORTCUTS
        // ==========================================
        document.addEventListener("keydown", (e) => {
            // Only trigger if not in an input, textarea, or contenteditable
            const target = e.target;
            const isTyping = target.tagName === "INPUT" || 
                             target.tagName === "TEXTAREA" || 
                             target.isContentEditable;

            if (e.key === "/" && !isTyping) {
                e.preventDefault();
                chrome.runtime.sendMessage({ action: "OPEN_AND_START_RECORDING" });
            }
        });
    }

    injectNiboUI();

    console.log("🤖 NIBO Content Script loaded");
})();