// NIBO Content Script — DOM Distillation & Action Execution
(function () {
    "use strict";

    let niboIdCounter = 0;
    const NIBO_ATTR = "data-nibo-id";
    const DOM_REFRESH_DELAY = 50; // ms to wait after an action before re-distilling

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

            const entry = { id: niboId, tag: el.tagName };

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

    function executeType(niboId, text) {
        const el = document.querySelector(`[${NIBO_ATTR}="${niboId}"]`);
        if (!el) {
            return {
                success: false,
                error: `Element "${niboId}" not found. Call get_page_elements again.`,
            };
        }

        el.scrollIntoView({ behavior: "instant", block: "center" });
        el.focus();
        el.dispatchEvent(new FocusEvent("focus", { bubbles: true }));
        el.click();

        // Use native setter so React/Vue pick up the change
        const setter =
            Object.getOwnPropertyDescriptor(
                window.HTMLInputElement.prototype,
                "value"
            )?.set ||
            Object.getOwnPropertyDescriptor(
                window.HTMLTextAreaElement.prototype,
                "value"
            )?.set;

        if (setter) {
            setter.call(el, text);
        } else {
            el.value = text;
        }

        el.dispatchEvent(new Event("input", { bubbles: true }));
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
    // MESSAGE HANDLING (background.js ↔ content.js)
    // ==========================================
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (message.action === "DISTILL_DOM") {
            const elements = distillDOM();
            sendResponse({
                success: true,
                elements,
                elementCount: elements.length,
                ...pageState(),
            });
            return true;
        }

        if (message.action === "EXECUTE_ACTION") {
            const { actionType, params } = message;
            let result;

            switch (actionType) {
                case "click":
                    result = executeClick(params.niboId);
                    break;
                case "type":
                    result = executeType(params.niboId, params.text);
                    break;
                case "press_key":
                    result = executePressKey(params.key);
                    break;
                case "scroll":
                    result = executeScroll(params.direction);
                    break;
                case "navigate":
                    // Navigate triggers page reload — return immediately, no DOM refresh
                    result = executeNavigate(params.url);
                    sendResponse(result);
                    return true;
                default:
                    result = { success: false, error: `Unknown action: ${actionType}` };
                    sendResponse(result);
                    return true;
            }

            // After a DOM-mutating action, wait briefly then return refreshed elements
            // so Gemini can chain the next action without a separate get_page_elements call
            setTimeout(() => {
                const elements = distillDOM();
                sendResponse({
                    ...result,
                    updatedElements: elements,
                    elementCount: elements.length,
                    ...pageState(),
                });
            }, DOM_REFRESH_DELAY);

            return true; // keep channel open for async sendResponse
        }
    });

    console.log("🤖 NIBO Content Script loaded");
})();