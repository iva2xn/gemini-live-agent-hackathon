// Open the side panel when the extension icon is clicked
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);

async function setupOffscreenDocument(path) {
    const existingContexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
        documentUrls: [chrome.runtime.getURL(path)]
    });

    if (existingContexts.length > 0) return;

    await chrome.offscreen.createDocument({
        url: path,
        reasons: ['USER_MEDIA'],
        justification: 'Recording microphone for Gemini Live API'
    });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // ── Mic / Screenshot controls ──
    if (message.action === 'START_RECORDING') {
        setupOffscreenDocument('offscreen.html').then(() => {
            chrome.runtime.sendMessage({ action: 'OFFSCREEN_START_MIC' });
        });
    }
    else if (message.action === 'STOP_RECORDING') {
        chrome.runtime.sendMessage({ action: 'OFFSCREEN_STOP_MIC' });
    }
    else if (message.action === 'TAKE_SCREENSHOT') {
        chrome.tabs.captureVisibleTab(null, { format: 'jpeg', quality: 80 }, (dataUrl) => {
            if (chrome.runtime.lastError) {
                console.error(chrome.runtime.lastError.message);
                return;
            }
            chrome.runtime.sendMessage({ action: 'OFFSCREEN_SEND_SCREENSHOT', payload: dataUrl });
        });
    }

    // ── Tool action relay (offscreen → content script → offscreen) ──
    else if (message.action === 'RELAY_ACTION') {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (!tabs || !tabs[0]) {
                chrome.runtime.sendMessage({
                    action: 'OFFSCREEN_ACTION_RESULT',
                    actionId: message.actionId,
                    result: { success: false, error: 'No active tab found.' },
                });
                return;
            }

            // Decide the content script message based on action type
            if (message.actionType === 'navigate') {
                let finalUrl = message.params.url;
                // Smart URL parser: if no protocol, and has a dot (facebook.com), add https://
                // Otherwise, treat as a google search.
                if (!finalUrl.startsWith('http://') && !finalUrl.startsWith('https://')) {
                    if (finalUrl.includes('.') && !finalUrl.includes(' ')) {
                        finalUrl = 'https://' + finalUrl;
                    } else {
                        finalUrl = 'https://google.com/search?q=' + encodeURIComponent(finalUrl);
                    }
                }
                chrome.tabs.update(tabs[0].id, { url: finalUrl }, () => {
                    chrome.runtime.sendMessage({
                        action: 'OFFSCREEN_ACTION_RESULT',
                        actionId: message.actionId,
                        result: { success: true, message: `Navigating to ${finalUrl}` }
                    });
                });
                return;
            }

            const contentMsg = message.actionType === 'get_elements'
                ? { action: 'DISTILL_DOM' }
                : { action: 'EXECUTE_ACTION', actionType: message.actionType, params: message.params };

            chrome.tabs.sendMessage(tabs[0].id, contentMsg, (response) => {
                if (chrome.runtime.lastError) {
                    chrome.runtime.sendMessage({
                        action: 'OFFSCREEN_ACTION_RESULT',
                        actionId: message.actionId,
                        result: { success: false, error: chrome.runtime.lastError.message },
                    });
                    return;
                }

                chrome.runtime.sendMessage({
                    action: 'OFFSCREEN_ACTION_RESULT',
                    actionId: message.actionId,
                    result: response,
                });
            });
        });
        return true; // keep channel open for async sendResponse
    }
});