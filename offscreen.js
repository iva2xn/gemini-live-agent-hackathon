let audioContext;
let mediaStream;
let ws;

chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'OFFSCREEN_START_MIC') {
        startRecording();
    } else if (message.action === 'OFFSCREEN_STOP_MIC') {
        stopRecording();
    } else if (message.action === 'OFFSCREEN_SEND_SCREENSHOT') {
        if (ws && ws.readyState === WebSocket.OPEN) {
            // Send screenshot as a JSON string over the same WebSocket
            ws.send(JSON.stringify({ type: 'screenshot', data: message.payload }));
        }
    }
});

async function startRecording() {
    // Connect to local Node.js relay
    ws = new WebSocket('ws://localhost:8080');

    ws.onopen = async () => {
        console.log("WebSocket connected");
        mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });

        // Setting sampleRate to 16000 forces the browser to natively resample the audio!
        audioContext = new AudioContext({ sampleRate: 16000 });
        const source = audioContext.createMediaStreamSource(mediaStream);

        // Load the AudioWorklet
        await audioContext.audioWorklet.addModule('processor.js');
        const workletNode = new AudioWorkletNode(audioContext, 'pcm-processor');

        workletNode.port.onmessage = (event) => {
            // event.data is a Float32Array containing mono 16kHz audio
            const float32Data = event.data;

            // Convert Float32 to 16-bit PCM (Int16) for Gemini Live API
            const int16Data = new Int16Array(float32Data.length);
            for (let i = 0; i < float32Data.length; i++) {
                let s = Math.max(-1, Math.min(1, float32Data[i]));
                int16Data[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
            }

            // Send raw binary PCM chunks to server
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(int16Data.buffer);
            }
        };

        source.connect(workletNode);
        workletNode.connect(audioContext.destination);
    };
}

function stopRecording() {
    if (audioContext) audioContext.close();
    if (mediaStream) mediaStream.getTracks().forEach(t => t.stop());
    if (ws) ws.close();
}