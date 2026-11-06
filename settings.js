// Keep the extension options entry point pointed at the same feature-complete UI
// and controller used by the toolbar popup. This prevents the two surfaces drifting.
window.location.replace(chrome.runtime.getURL("src/popup.html?full=1"));
