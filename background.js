console.log("[WCO v2] Background worker running");

// Relay messages to substrate page
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  chrome.runtime.sendMessage(msg);
  sendResponse({ ok: true });
});
