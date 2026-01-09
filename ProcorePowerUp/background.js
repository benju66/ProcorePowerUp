// background.js
chrome.action.onClicked.addListener((tab) => {
  // Ensure we only send the message if we have a valid tab ID
  if (tab.id) {
    chrome.tabs.sendMessage(tab.id, { action: "TOGGLE_UI" }).catch(err => {
      // Ignore errors if the content script isn't ready or matching (e.g. on a non-Procore tab)
    });
  }
});