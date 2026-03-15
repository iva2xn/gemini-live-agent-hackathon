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
    if (message.action === 'UPDATE_RISK') {
        const loadingState = document.getElementById('loadingState');
        const riskSection = document.getElementById('riskSection');
        const riskUrl = document.getElementById('riskUrl');
        const riskScoreBadge = document.getElementById('riskScoreBadge');
        const riskLevel = document.getElementById('riskLevel');
        const riskReasoning = document.getElementById('riskReasoning');

        if (!riskSection) return;

        if (loadingState) loadingState.style.display = 'none';
        riskSection.style.display = 'block';
        riskUrl.innerText = message.title || message.url;
        riskScoreBadge.innerText = message.riskScore;
        riskReasoning.innerText = message.reasoning;

        // Apply styling based on score
        if (message.riskScore < 30) {
            riskScoreBadge.style.backgroundColor = 'var(--primary)'; 
            riskLevel.innerText = "Safe Website";
            riskLevel.style.color = 'var(--primary)';
            riskScoreBadge.style.animation = 'none';
        } else if (message.riskScore < 60) {
            riskScoreBadge.style.backgroundColor = '#f59e0b'; // Amber
            riskLevel.innerText = "Moderate Risk";
            riskLevel.style.color = '#f59e0b';
            riskScoreBadge.style.animation = 'none';
        } else {
            riskScoreBadge.style.backgroundColor = '#ef4444'; // Red
            riskLevel.innerText = "High Risk / Scam Detected!";
            riskLevel.style.color = '#ef4444';
            if (message.riskScore > 80) {
                // Add CSS pulse if not present
                if (!document.getElementById('pulse-style')) {
                    const style = document.createElement('style');
                    style.id = 'pulse-style';
                    style.innerHTML = `@keyframes blink { 50% { opacity: 0.5; } }`;
                    document.head.appendChild(style);
                }
                riskScoreBadge.style.animation = 'blink 1s ease-in-out infinite';
            } else {
                riskScoreBadge.style.animation = 'none';
            }
        }
    }
});