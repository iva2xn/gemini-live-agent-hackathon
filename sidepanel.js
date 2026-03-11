document.getElementById('startBtn').addEventListener('click', async () => {
    try {
        // Check Chrome's Permission API instead of trying to open the mic
        const perm = await navigator.permissions.query({ name: 'microphone' });

        if (perm.state === 'granted') {
            // Permission is ON! Start recording instantly.
            chrome.runtime.sendMessage({ action: 'START_RECORDING' });

            document.getElementById('status').innerText = 'Status: Recording...';
            document.getElementById('startBtn').disabled = true;
            document.getElementById('stopBtn').disabled = false;
        } else {
            // Permission is OFF (or hasn't been asked yet). Open the setup tab.
            chrome.tabs.create({ url: chrome.runtime.getURL('permission.html') });
            document.getElementById('status').innerText = 'Please grant permission in the new tab.';
        }
    } catch (err) {
        console.error("Error checking permissions:", err);
    }
});

document.getElementById('stopBtn').addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'STOP_RECORDING' });
    document.getElementById('status').innerText = 'Status: Idle';
    document.getElementById('startBtn').disabled = false;
    document.getElementById('stopBtn').disabled = true;
});

document.getElementById('screenshotBtn').addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'TAKE_SCREENSHOT' });
});