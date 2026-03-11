navigator.mediaDevices.getUserMedia({ audio: true })
    .then((stream) => {
        // Stop the stream immediately, we just needed the permission
        stream.getTracks().forEach(t => t.stop());

        document.getElementById('message').innerText = "✅ Permission granted! You can close this tab and click 'Start Recording' in the Side Panel.";
        document.getElementById('message').style.color = "green";
    })
    .catch((err) => {
        document.getElementById('message').innerText = "❌ Permission denied. You must allow microphone access to use Autopilot.";
        document.getElementById('message').style.color = "red";
    });