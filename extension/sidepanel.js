// Config
const SERVER_URL = 'https://nibo-backend-512400763301.us-central1.run.app';

// DOM Elements
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const btnText = document.getElementById('btnText');
const recordingLabel = document.getElementById('recordingLabel');
const statusIcon = document.getElementById('statusIcon');
const macroList = document.getElementById('macroList');

// State
let isRecording = false;
let currentSessionActions = [];
let firstCommand = "";

// ════════════════════════════════════════
// Initialization
// ════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
    console.log("NIBO Macro Suite Initialized");
    refreshMacros();
});

// ════════════════════════════════════════
// Macro Management (Local Storage)
// ════════════════════════════════════════

async function refreshMacros() {
    if (!chrome || !chrome.storage || !chrome.storage.local) return;

    chrome.storage.local.get(['macros'], (result) => {
        const macros = result.macros || [];
        if (!macroList) return;
        
        if (!Array.isArray(macros) || macros.length === 0) {
            macroList.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">📂</div>
                    <p>No successful workflows saved yet.<br>Start recording to create one.</p>
                </div>
            `;
            return;
        }

        macroList.innerHTML = '';
        macros.reverse().forEach((macro, index) => {
            const card = document.createElement('div');
            card.className = 'macro-card';
            card.innerHTML = `
                <button class="macro-play-btn" title="Run Workflow">
                    <svg viewBox="0 0 24 24" fill="currentColor">
                        <path d="M8 5v14l11-7z"/>
                    </svg>
                </button>
                <div class="macro-info">
                    <div class="macro-title">${macro.name || 'Untitled Workflow'}</div>
                    <div class="macro-steps">${macro.actions ? macro.actions.length : 0} actions recorded</div>
                </div>
                <button class="delete-macro-btn" style="background:none; border:none; color:#94a3b8; cursor:pointer; padding:8px;" title="Delete">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path></svg>
                </button>
            `;
            
            card.querySelector('.macro-play-btn').onclick = () => playback(macro);
            card.querySelector('.delete-macro-btn').onclick = () => deleteMacro(macros.length - 1 - index);
            
            macroList.appendChild(card);
        });
    });
}

async function saveMacro(name, actions) {
    chrome.storage.local.get(['macros'], (result) => {
        const macros = result.macros || [];
        macros.push({ name, actions, timestamp: Date.now() });
        chrome.storage.local.set({ macros }, () => {
            console.log("Macro saved automatically");
            refreshMacros();
        });
    });
}

async function deleteMacro(index) {
    chrome.storage.local.get(['macros'], (result) => {
        const macros = result.macros || [];
        macros.splice(index, 1);
        chrome.storage.local.set({ macros }, () => {
            refreshMacros();
        });
    });
}

// ════════════════════════════════════════
// Improved Flexible Playback
// ════════════════════════════════════════

async function playback(macro) {
    console.log("Playing macro:", macro.name);
    
    for (const step of macro.actions) {
        let params = { ...step.params };
        
        // FLEXIBLE INPUT HANDLING
        if (step.actionType === 'type') {
            const context = step.context || "input field";
            const userText = prompt(`Playback: What would you like to put in the ${context}?`, params.text || "");
            if (userText === null) {
                console.log("Playback cancelled by user");
                return;
            }
            params.text = userText;
        }

        // Execute action
        await new Promise((resolve) => {
            chrome.runtime.sendMessage({
                action: 'RELAY_ACTION',
                actionType: step.actionType,
                params: params,
                actionId: 'macro-playback-' + Date.now()
            }, () => {
                setTimeout(resolve, 800); // Wait for page to settle
            });
        });
    }
    console.log("Macro finished");
}

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
                currentSessionActions = [];
                firstCommand = "";
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
        
        // Wait a small moment for final transcript to arrive
        setTimeout(async () => {
            if (currentSessionActions.length > 0) {
                console.log("Requesting AI summary for workflow...");
                try {
                    const response = await fetch(`${SERVER_URL}/summarize-macro`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            goal: firstCommand,
                            actions: currentSessionActions
                        })
                    });
                    const data = await response.json();
                    saveMacro(data.title || firstCommand || "New Workflow", currentSessionActions);
                } catch (err) {
                    console.error("AI summarization failed, using fallback:", err);
                    saveMacro(firstCommand || "New Workflow", currentSessionActions);
                }
            }
        }, 800);
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
    if (message.type === 'transcription' && isRecording && !firstCommand) {
        if (message.text && message.text.trim()) {
            firstCommand = message.text.trim();
            console.log("Captured first command for naming:", firstCommand);
        }
    }
    
    if (message.action === 'RECORD_ACTION' && isRecording) {
        // Skip get_elements as it's not a functional macro step
        if (message.actionType === 'get_elements') return;

        console.log("Recorded action:", message.actionType);
        
        // Capture context for 'type' actions
        let context = "";
        if (message.actionType === 'type') {
            context = "search bar"; // Default fallback
            // We could try to infer context from params if available
        }

        currentSessionActions.push({
            actionType: message.actionType,
            params: message.params,
            context: context
        });
    }
});