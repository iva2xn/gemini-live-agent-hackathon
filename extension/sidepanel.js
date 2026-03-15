// Config
const SERVER_URL = 'https://nibo-backend-512400763301.us-central1.run.app';

// DOM Elements
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const btnText = document.getElementById('btnText');
const recordingLabel = document.getElementById('recordingLabel');
const statusIcon = document.getElementById('statusIcon');
// State
let isRecording = false;

// ════════════════════════════════════════
// Initialization
// ════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
    console.log("NIBO Macro Suite Initialized");
});


// ════════════════════════════════════════
// Recording Controls
// ════════════════════════════════════════

if (startBtn) {
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
}

if (stopBtn) {
    stopBtn.addEventListener('click', async () => {
        chrome.runtime.sendMessage({ action: 'STOP_RECORDING' });
        setUIState(false);
    });
}

function setUIState(recording) {
    isRecording = recording;
    if (startBtn) startBtn.disabled = recording;
    if (stopBtn) stopBtn.disabled = !recording;
    if (statusIcon) statusIcon.classList.toggle('active', recording);
    if (btnText) btnText.innerText = recording ? 'Recording...' : 'Listen to Record';
    if (recordingLabel) recordingLabel.style.display = recording ? 'block' : 'none';
}

// ════════════════════════════════════════
// Smart Action Recording
// ════════════════════════════════════════

chrome.runtime.onMessage.addListener((message) => {
});