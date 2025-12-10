// popup.js

document.getElementById('startFilling').addEventListener('click', () => {
    // We send a message to the Service Worker to start the entire process.
    chrome.runtime.sendMessage({ action: 'startProcess' }, (response) => {
        console.log("Process initiation request sent to background.js");
        window.close(); // Close the popup after clicking the button
    });
});