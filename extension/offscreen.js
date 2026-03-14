let audioContext;
let mediaStream;
let ws;
let nextPlayTime = 0; // Keeps track of the audio queue so chunks play smoothly
let scheduledSources = []; // Track all scheduled AudioBufferSourceNodes for barge-in
let outputGain; // GainNode to control Gemini's output volume (mute on barge-in)

chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'OFFSCREEN_START_MIC') {
        startRecording();
    } else if (message.action === 'OFFSCREEN_STOP_MIC') {
        stopRecording();
    } else if (message.action === 'OFFSCREEN_SEND_SCREENSHOT') {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'screenshot', data: message.payload }));
        }
    }
    // ── Action result from content script (via background) → send to server ──
    else if (message.action === 'OFFSCREEN_ACTION_RESULT') {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'action_result',
                actionId: message.actionId,
                result: message.result,
            }));
        }
    }
});

async function startRecording() {
    // Prevent overlapping sessions
    if (ws || audioContext || mediaStream) {
        stopRecording();
    }

    // Connect to the ADK FastAPI WebSocket server on Cloud Run
    ws = new WebSocket('wss://nibo-backend-512400763301.us-central1.run.app/ws');

    ws.onopen = async () => {
        console.log("WebSocket connected to ADK Server");
        mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });

        // We keep our MIC recording at 16000 Hz
        audioContext = new AudioContext({ sampleRate: 16000 });
        nextPlayTime = audioContext.currentTime;

        await audioContext.audioWorklet.addModule('processor.js');
        const workletNode = new AudioWorkletNode(audioContext, 'pcm-processor');

        workletNode.port.onmessage = (event) => {
            const float32Data = event.data;
            const int16Data = new Int16Array(float32Data.length);
            for (let i = 0; i < float32Data.length; i++) {
                let s = Math.max(-1, Math.min(1, float32Data[i]));
                int16Data[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
            }
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(int16Data.buffer);
            }
        };

        const source = audioContext.createMediaStreamSource(mediaStream);
        source.connect(workletNode);

        // Connect through a SILENT GainNode so Chrome keeps processing the graph
        // (Chrome stops processing nodes not connected to destination)
        // Gain = 0 means no audible output = no feedback loop
        const silentGain = audioContext.createGain();
        silentGain.gain.value = 0;
        workletNode.connect(silentGain);
        silentGain.connect(audioContext.destination);

        // Keep-alive heartbeat to prevent WebSocket timeout
        window.wsHeartbeat = setInterval(() => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'ping' }));
            }
        }, 20000); // 20 seconds
    };

    // ==========================================
    // THE "SPEAKER" - Listen to Gemini via ADK
    // ==========================================
    ws.onmessage = async (event) => {
        if (typeof event.data === 'string') {
            const message = JSON.parse(event.data);

            if (message.type === 'audio') {
                playAudioChunk(message.data);
            }
            else if (message.type === 'interrupted') {
                console.log("Barge-in detected, stopping all queued audio");
                for (const src of scheduledSources) {
                    try { src.stop(); } catch (_) { /* already stopped */ }
                }
                scheduledSources = [];
                if (audioContext) nextPlayTime = audioContext.currentTime;
                // Drop any straggling audio messages from the network buffer for half a second
                window.ignoreAudioUntil = performance.now() + 500;
            }
            else if (message.type === 'turn_complete') {
                console.log("Gemini turn complete, listening...");
                // Clean up finished sources
                scheduledSources = [];
            }
            // ── Server is requesting a browser action ──
            else if (message.type === 'action') {
                console.log(`Action requested: ${message.action_type}`, message);
                chrome.runtime.sendMessage({
                    action: 'RELAY_ACTION',
                    actionId: message.actionId,
                    actionType: message.action_type,
                    params: message.params || {},
                });
            }
        }
    };
}

// Function to decode Gemini's Base64 audio and play it
async function playAudioChunk(base64Data) {
    if (!audioContext) return;
    if (window.ignoreAudioUntil && performance.now() < window.ignoreAudioUntil) {
        return; // Drop straggling chunk from before the interruption
    }
    if (audioContext.state === 'suspended') {
        await audioContext.resume();
    }

    // 1. Decode Base64 string into raw binary bytes
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }

    // 2. Convert 16-bit PCM (Int16) to Float32 (Web Audio API requires Float32)
    const int16Array = new Int16Array(bytes.buffer);
    const float32Array = new Float32Array(int16Array.length);
    for (let i = 0; i < int16Array.length; i++) {
        float32Array[i] = int16Array[i] / 32768.0;
    }

    // 3. Create Audio Buffer (Set exactly to 24000 Hz so it sounds natural)
    const audioBuffer = audioContext.createBuffer(1, float32Array.length, 24000);
    audioBuffer.getChannelData(0).set(float32Array);

    // 4. Lazily create output gain node (used for barge-in muting)
    if (!outputGain || outputGain.context !== audioContext) {
        outputGain = audioContext.createGain();
        outputGain.gain.value = 1.0;
        outputGain.connect(audioContext.destination);
    }

    // 5. Schedule playback so it doesn't overlap or stutter
    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(outputGain);

    const currentTime = audioContext.currentTime;
    if (nextPlayTime < currentTime) {
        nextPlayTime = currentTime; // Catch up if we fell behind
    }

    source.start(nextPlayTime);
    scheduledSources.push(source);

    // Auto-remove from tracking when the source finishes playing
    source.onended = () => {
        const idx = scheduledSources.indexOf(source);
        if (idx !== -1) scheduledSources.splice(idx, 1);
    };

    nextPlayTime += audioBuffer.duration; // Queue the next chunk exactly when this one ends
}

function stopRecording() {
    if (audioContext) {
        audioContext.close();
        audioContext = null;
    }
    if (mediaStream) {
        mediaStream.getTracks().forEach(t => t.stop());
        mediaStream = null;
    }
    if (ws) {
        ws.close();
        ws = null;
    }
    if (window.wsHeartbeat) {
        clearInterval(window.wsHeartbeat);
        window.wsHeartbeat = null;
    }
    scheduledSources = [];
    outputGain = null;
}