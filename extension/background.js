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
    // Relay transcription to sidepanel for naming
    else if (message.type === 'transcription') {
        chrome.runtime.sendMessage(message).catch(() => {});
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

    else if (message.action === 'RELAY_ACTION') {
        console.log("Relaying action:", message.actionType);
        
        // Broadcast to sidepanel for recording (unless it's a playback action itself)
        if (message.actionId !== 'macro-playback' && !message.actionId?.startsWith('macro-playback-')) {
            chrome.runtime.sendMessage({
                action: 'RECORD_ACTION',
                actionType: message.actionType,
                params: message.params
            }).catch(() => {});
        }

        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (!tabs || !tabs[0]) {
                const errorRes = { success: false, error: 'No active tab found.' };
                if (message.actionId !== 'macro-playback') {
                    chrome.runtime.sendMessage({ action: 'OFFSCREEN_ACTION_RESULT', actionId: message.actionId, result: errorRes });
                }
                return;
            }

            // Decide the content script message based on action type
            if (message.actionType === 'navigate') {
                let finalUrl = message.params.url;
                if (!finalUrl.startsWith('http://') && !finalUrl.startsWith('https://')) {
                    if (finalUrl.includes('.') && !finalUrl.includes(' ')) {
                        finalUrl = 'https://' + finalUrl;
                    } else {
                        finalUrl = 'https://google.com/search?q=' + encodeURIComponent(finalUrl);
                    }
                }
                const targetTabId = tabs[0].id;
                chrome.tabs.update(targetTabId, { url: finalUrl }, () => {
                    const listener = (tabId, changeInfo) => {
                        if (tabId === targetTabId && changeInfo.status === 'complete') {
                            chrome.tabs.onUpdated.removeListener(listener);
                            clearTimeout(fallback);
                            chrome.runtime.sendMessage({
                                action: 'OFFSCREEN_ACTION_RESULT',
                                actionId: message.actionId,
                                result: { success: true, message: `Navigated to ${finalUrl}` }
                            });
                        }
                    };
                    chrome.tabs.onUpdated.addListener(listener);
                    const fallback = setTimeout(() => {
                        chrome.tabs.onUpdated.removeListener(listener);
                        chrome.runtime.sendMessage({
                            action: 'OFFSCREEN_ACTION_RESULT',
                            actionId: message.actionId,
                            result: { success: true, message: `Navigated to ${finalUrl} (timeout)` }
                        });
                    }, 10000);
                });
                return;
            }

            const contentMsg = message.actionType === 'get_elements'
                ? { action: 'DISTILL_DOM' }
                : { action: 'EXECUTE_ACTION', actionType: message.actionType, params: message.params };

            chrome.tabs.sendMessage(tabs[0].id, contentMsg, (response) => {
                const result = chrome.runtime.lastError 
                    ? { success: true, message: "Action succeeded (navigation/reload)." }
                    : response;

                chrome.runtime.sendMessage({
                    action: 'OFFSCREEN_ACTION_RESULT',
                    actionId: message.actionId,
                    result: result,
                });
            });
        });
        return true;
    }

    // ── Macro Playback ──
    else if (message.action === 'PLAYBACK_MACRO') {
        async function runSteps(steps) {
            console.log("Starting macro playback with", steps.length, "steps");
            for (const step of steps) {
                console.log("Playing step:", step.actionType);
                await new Promise((resolve) => {
                    // Reuse the existing relay logic by triggering a RELAY_ACTION
                    // But we don't need an actionId since we're not sending it back to Gemini
                    chrome.runtime.sendMessage({
                        action: 'RELAY_ACTION',
                        actionType: step.actionType,
                        params: step.params,
                        actionId: 'macro-playback'
                    }, () => {
                        // Wait a bit for the action to complete/settle
                        setTimeout(resolve, 1000);
                    });
                });
            }
            console.log("Macro playback finished");
        }
        runSteps(message.steps);
    }
});