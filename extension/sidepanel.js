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
const workflowsView = document.getElementById('workflowsView');
const workflowsList = document.getElementById('workflowsList');
const playLibraryBtn = document.getElementById('playLibraryBtn');
const closeWorkflowsBtn = document.getElementById('closeWorkflowsBtn');

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

    if (playLibraryBtn) {
        playLibraryBtn.addEventListener('click', () => openWorkflows());
    }

    if (closeWorkflowsBtn) {
        closeWorkflowsBtn.addEventListener('click', () => {
            workflowsView.style.display = 'none';
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

/**
 * Fetch and display workflows from the backend
 */
async function openWorkflows() {
    if (!workflowsView || !workflowsList) return;
    workflowsView.style.display = 'block';
    workflowsList.innerHTML = '<div style="text-align: center; padding: 20px;">Loading library...</div>';

    try {
        const res = await fetch(`${SERVER_URL}/api/workflows`);
        const data = await res.json();
        
        if (data.error) throw new Error(data.error);

        if (data.workflows.length === 0) {
            workflowsList.innerHTML = '<div style="text-align: center; color: var(--muted-foreground); padding: 20px;">No saved instructions found. Switch to Shield Mode to create some!</div>';
            return;
        }

        workflowsList.innerHTML = '';
        data.workflows.forEach(wf => {
            const item = document.createElement('div');
            item.style = 'display: flex; align-items: center; gap: 12px; padding: 12px; background: whitesmoke; border-radius: 12px; border: 1px solid var(--border); margin-bottom: 8px; overflow: hidden;';
            
            item.innerHTML = `
                <button class="play-workflow-btn" data-file="${wf.filename}" style="background: var(--primary); color: white; border: none; border-radius: 50%; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; cursor: pointer; flex-shrink: 0;" title="Play">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                </button>
                <div style="flex: 1; min-width: 0;">
                    <div style="font-weight: 600; font-size: 14px; margin-bottom: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${wf.description}</div>
                    <div style="font-size: 11px; color: var(--muted-foreground);">${wf.filename}</div>
                </div>
                <button class="delete-workflow-btn" data-file="${wf.filename}" style="background: none; border: none; color: #ef4444; padding: 4px; cursor: pointer; opacity: 0.6; transition: opacity 0.2s;" title="Delete">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18m-2 0v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6m3 0V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2m-6 9h4m-4-4h4"/></svg>
                </button>
            `;
            
            item.querySelector('.play-workflow-btn').addEventListener('click', () => playWorkflow(wf.filename));
            item.querySelector('.delete-workflow-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                if (confirm(`Delete "${wf.description}"?`)) {
                    deleteWorkflow(wf.filename);
                }
            });
            item.querySelector('.delete-workflow-btn').addEventListener('mouseenter', (e) => e.target.style.opacity = '1');
            item.querySelector('.delete-workflow-btn').addEventListener('mouseleave', (e) => e.target.style.opacity = '0.6');

            workflowsList.appendChild(item);
        });
    } catch (err) {
        console.error("Failed to fetch workflows:", err);
        workflowsList.innerHTML = `<div style="text-align: center; color: #ef4444; padding: 20px;">Error loading library: ${err.message}</div>`;
    }
}

/**
 * Delete a workflow file
 */
async function deleteWorkflow(filename) {
    try {
        const res = await fetch(`${SERVER_URL}/api/workflows/${filename}`, {
            method: 'DELETE'
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        
        console.log(`🗑️ Deleted workflow: ${filename}`);
        openWorkflows(); // Refresh list
    } catch (err) {
        alert("Failed to delete: " + err.message);
    }
}

/**
 * Execute a workflow by feeding its content to the Talk Agent
 */
async function playWorkflow(filename) {
    try {
        // 1. Fetch content
        const res = await fetch(`${SERVER_URL}/api/workflows/${filename}`);
        const data = await res.json();
        if (data.error) throw new Error(data.error);

        // 2. Switch to Talk Mode if not already
        if (currentMode !== 'talk') {
            setMode('talk');
        }

        // 3. Start recording if not already
        if (!isRecording) {
            chrome.runtime.sendMessage({ 
                action: 'START_RECORDING',
                mode: 'talk' 
            });
            setUIState(true);
            // Give WS a moment to connect
            await new Promise(r => setTimeout(r, 1000));
        }

        // 4. Send instructions to offscreen -> WebSocket
        chrome.runtime.sendMessage({ 
            action: 'OFFSCREEN_ACTION_RESULT', 
            actionId: 'PLAYBACK', // Special ID for UI-triggered instructions
            result: { success: true, playback_instruction: data.content }
        });

        workflowsView.style.display = 'none';
        console.log(`▶️ Playing workflow: ${filename}`);
    } catch (err) {
        alert("Failed to play instruction: " + err.message);
    }
}