"use strict";

const BADGE_COLOR = "#fb7299";

function enableActionSidePanel() {
  return chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.error("无法启用侧边栏入口", error));
}

function setThreadBadge(tabId, enabled, activeThreads) {
  if (!Number.isInteger(tabId)) return Promise.resolve();
  const count = Math.max(0, Math.min(512, Math.trunc(Number(activeThreads) || 0)));
  const text = enabled ? String(count) : "";
  return Promise.all([
    chrome.action.setBadgeBackgroundColor({ tabId, color: BADGE_COLOR }),
    chrome.action.setBadgeText({ tabId, text })
  ]).catch((error) => console.error("无法更新线程徽标", error));
}

// 0.9.1.2 moves existing users once to mainland CDN, 8 threads and hidden error notices.
// Other settings are kept. A fresh install already starts with these defaults.
const SETTINGS_REVISION = 2;
async function migrateSettings() {
  const stored = await chrome.storage.sync.get(null);
  if (stored.settingsRevision === SETTINGS_REVISION) return;
  const existing = Object.keys(stored).some((key) => key !== "settingsRevision");
  await chrome.storage.sync.set({
    settingsRevision: SETTINGS_REVISION,
    ...(existing ? { mode: "mainland", concurrency: 8, errorNotices: false } : {})
  });
}

function prepareExtension() {
  enableActionSidePanel();
  migrateSettings().catch((error) => console.error("无法更新默认设置", error));
}

enableActionSidePanel();
chrome.runtime.onInstalled.addListener(prepareExtension);
chrome.runtime.onStartup.addListener(prepareExtension);

// 0.9.x 的弹幕和字幕都由 B 站原生播放器负责，这里只剩线程徽标。
chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type !== "setThreadBadge") return false;
  setThreadBadge(sender.tab?.id, message.enabled === true, message.activeThreads);
  return false;
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") setThreadBadge(tabId, false, 0);
});
