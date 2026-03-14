// DOM Elements
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const settingsBtn = document.getElementById('settingsBtn');

const statusIcon = document.getElementById('statusIcon');
const chatList = document.getElementById('chatList');
const macroList = document.getElementById('macroList');
const tabChat = document.getElementById('tabChat');
const tabMacros = document.getElementById('tabMacros');
const paneChat = document.getElementById('paneChat');
const paneMacros = document.getElementById('paneMacros');

// State
let isRecording = false;

// ════════════════════════════════════════
// Initialization
// ════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
    // Logic for fetching history/macros removed as requested
});

settingsBtn.addEventListener('click', () => {
    console.log("Settings clicked - implementation coming soon!");
});


// ════════════════════════════════════════
// Tab Management
// ════════════════════════════════════════

function switchTab(tabId, paneId) {
    [tabChat, tabMacros].forEach(t => t.classList.remove('active'));
    [paneChat, paneMacros].forEach(p => p.classList.remove('active'));

    document.getElementById(tabId).classList.add('active');
    document.getElementById(paneId).classList.add('active');
}

tabChat.addEventListener('click', () => switchTab('tabChat', 'paneChat'));
tabMacros.addEventListener('click', () => switchTab('tabMacros', 'paneMacros'));

// ════════════════════════════════════════
// Recording Controls
// ════════════════════════════════════════

startBtn.addEventListener('click', async () => {
    try {
        const perm = await navigator.permissions.query({ name: 'microphone' });

        if (perm.state === 'granted') {
            chrome.runtime.sendMessage({ action: 'START_RECORDING' });
            setUIState(true);
        } else {
            chrome.tabs.create({ url: chrome.runtime.getURL('permission.html') });
        }

    } catch (err) {
        console.error("Error checking permissions:", err);
    }
});

stopBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'STOP_RECORDING' });
    setUIState(false);
});

function setUIState(recording) {
    isRecording = recording;
    if (startBtn) startBtn.disabled = recording;
    if (stopBtn) stopBtn.disabled = !recording;
    if (statusIcon) statusIcon.classList.toggle('active', recording);
}

// ════════════════════════════════════════
// Real-time Updates
// ════════════════════════════════════════

chrome.runtime.onMessage.addListener((message) => {
    // Message handling logic removed as requested
});