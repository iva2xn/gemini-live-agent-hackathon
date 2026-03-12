class PCMProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.bufferData = new Float32Array(1024);
        this.bufferPointer = 0;
    }

    process(inputs, outputs, parameters) {
        const input = inputs[0];
        if (input && input.length > 0) {
            const monoChannelData = input[0];

            for (let i = 0; i < monoChannelData.length; i++) {
                this.bufferData[this.bufferPointer++] = monoChannelData[i];

                if (this.bufferPointer >= this.bufferData.length) {
                    // Send the batch back down to offscreen.js
                    // We must slice or copy, else it gets destroyed
                    this.port.postMessage(this.bufferData.slice());
                    this.bufferPointer = 0; // reset
                }
            }
        }
        return true; // Keep the processor alive
    }
}

registerProcessor('pcm-processor', PCMProcessor);