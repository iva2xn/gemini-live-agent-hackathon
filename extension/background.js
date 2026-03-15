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
    }
});

// ════════════════════════════════════════
// CONTINUOUS RISK SCANNING
// ════════════════════════════════════════
const BACKEND_URL = 'https://nibo-backend-512400763301.us-central1.run.app'; // Update to your deployed Cloud Run URL if needed

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // Only scan when the page is fully loaded and it is not an internal chrome page
    if (changeInfo.status === 'complete' && tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('edge://')) {
        // Wait briefly for UI frameworks to render
        setTimeout(() => {
            chrome.tabs.sendMessage(tabId, { action: "DISTILL_DOM" }, (response) => {
                if (chrome.runtime.lastError) {
                    console.log("[Scanner] Content script not ready or error:", chrome.runtime.lastError.message);
                    return;
                }
                
                if (response && response.success) {
                    console.log(`[Scanner] Sending ${response.url} for safety analysis...`);
                    fetch(`${BACKEND_URL}/api/scan`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            url: response.url,
                            title: response.title,
                            elements: response.elements || []
                        })
                    })
                    .then(res => res.json())
                    .then(data => {
                        console.log("[Scanner] Scan Result:", data);
                        
                        // Send to Side Panel
                        chrome.runtime.sendMessage({ 
                            action: 'UPDATE_RISK', 
                            url: response.url,
                            title: response.title,
                            riskScore: data.risk_score || 0, 
                            reasoning: data.reasoning || ""
                        }).catch(() => {
                            // Suppress error if the side panel is not open
                        });

                        // If score is high risk (e.g. > 60), send native OS background notification
                        if (data.risk_score > 60) {
                            chrome.notifications.create({
                                type: 'basic',
                                iconUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FAMqEFAFv4XfHAAAAAElFTkSuQmCC', // Red dot placeholder icon
                                title: '⚠️ High Risk Website Detected',
                                message: `NIBO Risk Score: ${data.risk_score}/100\nReason: ${data.reasoning}`,
                                priority: 2,
                                requireInteraction: true
                            });
                        }
                        
                    })
                    .catch(err => console.error("[Scanner] Server scan error:", err));
                }
            });
        }, 1500); // 1.5s delay
    }
});