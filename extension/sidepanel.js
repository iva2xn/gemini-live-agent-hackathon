const SERVER_URL = 'https://nibo-backend-512400763301.us-central1.run.app';

// DOM Elements
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const btnText = document.getElementById('btnText');
const recordingLabel = document.getElementById('recordingLabel');
const statusIcon = document.getElementById('statusIcon');
const talkModeBtn = document.getElementById('talkModeBtn');
const shieldModeBtn = document.getElementById('shieldModeBtn');

// State
let isRecording = false;
let currentMode = 'talk'; // 'talk' or 'shield'

// DOM Elements Settings
const settingsBtn = document.getElementById('settingsBtn');
const backBtn = document.getElementById('backBtn');
const settingsView = document.getElementById('settingsView');

// ════════════════════════════════════════
// Initialization
// ════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
    console.log("NIBO Macro Suite Initialized");

    if (settingsBtn && settingsView) {
        settingsBtn.addEventListener('click', () => {
            settingsView.style.display = 'block';
        });
    }

    if (backBtn && settingsView) {
        backBtn.addEventListener('click', () => {
            settingsView.style.display = 'none';
        });
    }

    // Mode Toggle Logic
    if (talkModeBtn && shieldModeBtn) {
        talkModeBtn.addEventListener('click', () => setMode('talk'));
        shieldModeBtn.addEventListener('click', () => setMode('shield'));
    }
});

function setMode(mode) {
    if (currentMode === mode) return;

    // If recording, stop it first to reset microphone/WS
    if (isRecording) {
        if (stopBtn) stopBtn.click();
    }

    currentMode = mode;

    // Update UI
    if (talkModeBtn) talkModeBtn.classList.toggle('active', mode === 'talk');
    if (shieldModeBtn) shieldModeBtn.classList.toggle('active', mode === 'shield');
    
    // Update button text context
    if (btnText) {
        btnText.innerText = mode === 'talk' ? 'Listen to Record' : 'Start Shielding';
    }

    // Update Risk Header
    const riskHeader = document.getElementById('riskHeader');
    const loadingMessage = document.querySelector('#loadingState p');
    const riskSection = document.getElementById('riskSection');
    const loadingState = document.getElementById('loadingState');

    // Reset UI to neutral state on mode switch
    if (riskSection) riskSection.style.display = 'none';
    if (loadingState) loadingState.style.display = 'block';

    if (mode === 'talk') {
        if (riskHeader) riskHeader.innerText = "Live Risk Detection";
        if (loadingMessage) loadingMessage.innerText = "Live Risk Detection Active";
    } else {
        if (riskHeader) riskHeader.innerText = "Call Security Analysis";
        if (loadingMessage) loadingMessage.innerText = "Shield Monitoring Active";
    }

    console.log(`Mode switched to: ${mode}`);
}


// ════════════════════════════════════════
// Recording Controls
// ════════════════════════════════════════

if (startBtn) {
    startBtn.addEventListener('click', async () => {
        try {
            const perm = await navigator.permissions.query({ name: 'microphone' });
            if (perm.state === 'granted') {
                chrome.runtime.sendMessage({ 
                    action: 'START_RECORDING',
                    mode: currentMode 
                });
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
        const riskHeader = document.getElementById('riskHeader');
        const riskTitle = document.getElementById('riskTitle');
        const riskScoreBadge = document.getElementById('riskScoreBadge');
        const riskLevel = document.getElementById('riskLevel');
        const riskReasoning = document.getElementById('riskReasoning');

        if (!riskSection) return;

        // CRITICAL: If in Shield Mode, ONLY show audio risks. 
        // Ignore standard website scans from background.js
        if (currentMode === 'shield' && !message.isAudioRisk) {
            console.log("Shield Mode: Ignoring website risk scan.");
            return;
        }

        if (loadingState) loadingState.style.display = 'none';
        riskSection.style.display = 'block';
        
        if (message.isAudioRisk) {
            if (riskHeader) riskHeader.innerText = "Call Security Analysis";
            if (riskTitle) riskTitle.innerText = message.scamType || "Potential Call Scam";
        } else {
            if (riskHeader) riskHeader.innerText = "Live Risk Detection";
            if (riskTitle) riskTitle.innerText = message.title || message.url;
        }
        riskScoreBadge.innerText = message.riskScore;
        riskReasoning.innerText = message.reasoning;

        // Apply styling based on score
        if (message.riskScore < 30) {
            riskScoreBadge.style.backgroundColor = 'var(--primary)'; 
            riskLevel.innerText = message.isAudioRisk ? "Conversation Safe" : "Safe Website";
            riskLevel.style.color = 'var(--primary)';
            riskScoreBadge.style.animation = 'none';
        } else if (message.riskScore < 60) {
            riskScoreBadge.style.backgroundColor = '#f59e0b'; // Amber
            riskLevel.innerText = message.isAudioRisk ? "Suspicious Activity" : "Moderate Risk";
            riskLevel.style.color = '#f59e0b';
            riskScoreBadge.style.animation = 'none';
        } else {
            riskScoreBadge.style.backgroundColor = '#ef4444'; // Red
            riskLevel.innerText = message.isAudioRisk ? "Scam Detected / Hang Up!" : "High Risk / Scam Detected!";
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
    } else if (message.action === 'TRIGGER_AUTO_RECORD') {
        if (startBtn && !isRecording) {
            startBtn.click();
        }
    }
});