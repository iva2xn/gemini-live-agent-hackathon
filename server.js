const WebSocket = require('ws');

const wss = new WebSocket.Server({ port: 8080 });

wss.on('connection', (ws) => {
    console.log('Extension connected to Local Relay!');

    ws.on('message', (message, isBinary) => {
        if (isBinary) {
            // 16kHz, 16-bit PCM Mono Audio Chunk received!
            // 'message' is a Buffer here.
            // READY TO BE FORWARDED TO GEMINI LIVE API
            console.log(`Received Audio Chunk: ${message.length} bytes`);
        } else {
            // Text data received (Screenshots)
            const data = JSON.parse(message.toString());
            if (data.type === 'screenshot') {
                // data.data contains the Base64 JPEG string
                console.log(`Received Screenshot: ${data.data.substring(0, 50)}...`);
            }
        }
    });

    ws.on('close', () => {
        console.log('Extension disconnected.');
    });
});

console.log('Local Audio Bridge running on ws://localhost:8080');