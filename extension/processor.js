class PCMProcessor extends AudioWorkletProcessor {
    process(inputs, outputs, parameters) {
        const input = inputs[0];
        if (input && input.length > 0) {
            const monoChannelData = input[0];
            // Send the Float32Array to offscreen.js
            this.port.postMessage(monoChannelData);
        }
        return true; // Keep the processor alive
    }
}

registerProcessor('pcm-processor', PCMProcessor);