"use strict";
// 回归测试原来把 Chrome 路径写死成 Windows 的安装目录，别的机器和 CI 都跑不起来。
// 顺序是：BTR_CHROME_PATH 指定的浏览器 → 本机常见的 Chrome 安装位置 → Playwright 自带的
// Chromium。显式设了 BTR_CHROME_PATH 就一定用它，路径不对要直接报错，不能悄悄换掉。
const fs = require("node:fs");

const LOCAL_CHROME_PATHS = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable"
];

function chromeExecutablePath() {
  const requested = String(process.env.BTR_CHROME_PATH || "").trim();
  if (requested) return requested;
  return LOCAL_CHROME_PATHS.find((candidate) => {
    try { return fs.statSync(candidate).isFile(); }
    catch (_error) { return false; }
  }) || null;
}

function chromeLaunchOptions(extra = {}) {
  const executablePath = chromeExecutablePath();
  return { headless: true, ...(executablePath ? { executablePath } : {}), ...extra };
}

module.exports = { chromeExecutablePath, chromeLaunchOptions };
