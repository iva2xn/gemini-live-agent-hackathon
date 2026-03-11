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
    if (message.action === 'START_RECORDING') {
        setupOffscreenDocument('offscreen.html').then(() => {
            chrome.runtime.sendMessage({ action: 'OFFSCREEN_START_MIC' });
        });
    }
    else if (message.action === 'STOP_RECORDING') {
        chrome.runtime.sendMessage({ action: 'OFFSCREEN_STOP_MIC' });
    }
    else if (message.action === 'TAKE_SCREENSHOT') {
        // Capture the visible tab and forward it to the offscreen script (to send via WebSocket)
        chrome.tabs.captureVisibleTab(null, { format: 'jpeg', quality: 80 }, (dataUrl) => {
            if (chrome.runtime.lastError) {
                console.error(chrome.runtime.lastError.message);
                return;
            }
            chrome.runtime.sendMessage({ action: 'OFFSCREEN_SEND_SCREENSHOT', payload: dataUrl });
        });
    }
});