// NIBO Background Script
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);

const sidePanelStates = new Map();

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
    const tabId = sender?.tab?.id;

    // ── Side Panel Toggle ──
    if (message.action === 'TOGGLE_SIDE_PANEL' && tabId) {
        const isOpen = sidePanelStates.get(tabId) || false;
        
        if (!isOpen) {
            chrome.sidePanel.setOptions({ tabId, enabled: true, path: 'sidepanel.html' }, () => {
                chrome.sidePanel.open({ tabId })
                    .then(() => sidePanelStates.set(tabId, true))
                    .catch(console.error);
            });
        } else {
            chrome.sidePanel.setOptions({ tabId, enabled: false }, () => {
                sidePanelStates.set(tabId, false);
                setTimeout(() => {
                    chrome.sidePanel.setOptions({ tabId, enabled: true, path: 'sidepanel.html' });
                }, 100);
            });
        }
    }

    else if (message.action === 'OPEN_AND_START_RECORDING' && tabId) {
        chrome.sidePanel.setOptions({ tabId, enabled: true, path: 'sidepanel.html' }, () => {
            chrome.sidePanel.open({ tabId }).then(() => {
                sidePanelStates.set(tabId, true);
                // Wait a bit for the side panel to load its script
                setTimeout(() => {
                    chrome.runtime.sendMessage({ action: 'TRIGGER_AUTO_RECORD' });
                }, 800);
            });
        });
    }

    // ── Mic / Screenshot controls ──
    else if (message.action === 'START_RECORDING') {
        setupOffscreenDocument('offscreen.html').then(() => {
            chrome.runtime.sendMessage({ 
                action: 'OFFSCREEN_START_MIC',
                mode: message.mode
            });
        });
    }
    else if (message.action === 'STOP_RECORDING') {
        chrome.runtime.sendMessage({ action: 'OFFSCREEN_STOP_MIC' });
    }
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

    // ── Agent Action Relay ──
    else if (message.action === 'RELAY_ACTION') {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (!tabs || !tabs[0]) return;

            if (message.actionType === 'navigate') {
                let finalUrl = message.params.url;
                if (!finalUrl.startsWith('http://') && !finalUrl.startsWith('https://')) {
                    finalUrl = (finalUrl.includes('.') && !finalUrl.includes(' ')) ? 'https://' + finalUrl : 'https://google.com/search?q=' + encodeURIComponent(finalUrl);
                }
                const targetTabId = tabs[0].id;
                chrome.tabs.update(targetTabId, { url: finalUrl }, () => {
                    const listener = (tid, changeInfo) => {
                        if (tid === targetTabId && changeInfo.status === 'complete') {
                            chrome.tabs.onUpdated.removeListener(listener);
                            chrome.runtime.sendMessage({ action: 'OFFSCREEN_ACTION_RESULT', actionId: message.actionId, result: { success: true, message: `Navigated to ${finalUrl}` } });
                        }
                    };
                    chrome.tabs.onUpdated.addListener(listener);
                });
                return;
            }

            const contentMsg = message.actionType === 'get_elements' ? { action: 'DISTILL_DOM' } : { action: 'EXECUTE_ACTION', actionType: message.actionType, params: message.params };
            chrome.tabs.sendMessage(tabs[0].id, contentMsg, (response) => {
                const result = chrome.runtime.lastError ? { success: true, message: "Action succeeded (navigation/reload)." } : response;
                chrome.runtime.sendMessage({ action: 'OFFSCREEN_ACTION_RESULT', actionId: message.actionId, result: result });
            });
        });
    }
});

// ── Continuous Risk Scanning ──
const BACKEND_URL = 'https://nibo-backend-512400763301.us-central1.run.app';

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('edge://')) {
        setTimeout(() => {
            chrome.tabs.sendMessage(tabId, { action: "DISTILL_DOM" }, (response) => {
                if (chrome.runtime.lastError || !response || !response.success) return;
                
                fetch(`${BACKEND_URL}/api/scan`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url: response.url, title: response.title, elements: response.elements || [] })
                })
                .then(res => res.json())
                .then(data => {
                    chrome.runtime.sendMessage({ action: 'UPDATE_RISK', url: response.url, title: response.title, riskScore: data.risk_score || 0, reasoning: data.reasoning || "" }).catch(() => {});
                    if (data.risk_score > 60) {
                        chrome.notifications.create({
                            type: 'basic',
                            iconUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FAMqEFAFv4XfHAAAAAElFTkSuQmCC',
                            title: '⚠️ High Risk Website Detected',
                            message: `NIBO Risk Score: ${data.risk_score}/100\nReason: ${data.reasoning}`,
                            priority: 2,
                            requireInteraction: true
                        });
                    }
                })
                .catch(err => console.error("[Scanner] Server scan error:", err));
            });
        }, 1500);
    }
});