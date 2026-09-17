"use strict";
// Needs dev/server.js. Checks the built user_scripts/bilibili-thread-ripper.user.js.
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const { chromium } = require("playwright");
const { chromeLaunchOptions } = require("./chrome-path.js");

const root = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const script = fs.readFileSync(path.join(root, "user_scripts/bilibili-thread-ripper.user.js"), "utf8");
const scriptUrl = "https://raw.githubusercontent.com/MrTangLuyao/Bilibili-thread-ripper/main/user_scripts/bilibili-thread-ripper.user.js";
const source = file => fs.readFileSync(path.join(root, file), "utf8").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").trimEnd();

function checkFile() {
  assert.ok(script.startsWith("// ==UserScript==\n"), "Tampermonkey needs the header on the first line");
  const header = script.slice(0, script.indexOf("// ==/UserScript=="));
  const values = name => [...header.matchAll(new RegExp(`^// @${name}\\s+(.+)$`, "gm"))].map(match => match[1].trim());
  assert.deepEqual(values("version"), [manifest.version]);
  assert.deepEqual(values("updateURL"), [scriptUrl]);
  assert.deepEqual(values("downloadURL"), [scriptUrl]);
  assert.deepEqual(values("match"), ["https://www.bilibili.com/*", "https://m.bilibili.com/*"]);
  assert.deepEqual(values("run-at"), ["document-start"]);
  assert.deepEqual(values("grant").sort(), ["GM_addElement", "GM_registerMenuCommand", "unsafeWindow"]);
  assert.match(header, /^\/\/ @noframes$/m);
  new vm.Script(script, { filename: "bilibili-thread-ripper.user.js" });
  // The extension's page code and its sidebar are included unchanged and in order.
  const parts = [
    ...["user_scripts/adapter/storage-shim.js", ...manifest.content_scripts.flatMap(item => item.js)].map(file => `/* ${file} */\n${source(file)}\n`),
    `/* popup/popup.js */\nfunction runPopup(document, chrome, window) {\n${source("popup/popup.js")}\n}\n`,
    `/* user_scripts/adapter/settings-panel.js */\n${source("user_scripts/adapter/settings-panel.js")}\n`,
    `/* user_scripts/adapter/loader.js */\n${source("user_scripts/adapter/loader.js")}\n`
  ];
  let position = 0;
  for (const part of parts) {
    const at = script.indexOf(part, position);
    assert.ok(at >= position, `${part.split("\n")[0]} missing, changed or out of order`);
    position = at;
  }
  const constant = name => JSON.parse(script.match(new RegExp(`^const ${name} = (.+);$`, "m"))[1]);
  assert.equal(constant("POPUP_HTML"), source("popup/popup.html").match(/<main>[\s\S]*<\/main>/)[0]);
  assert.equal(constant("POPUP_CSS"), source("popup/popup.css"));
  console.log("PASS 油猴脚本头部、自动更新地址和打包内容正确，侧边栏设置页原样打包");
}

const settingsHost = "#__bilibili_thread_ripper_userscript_settings__";
const openSettings = page => page.evaluate(() => document.dispatchEvent(new CustomEvent("btr-userscript-open-settings")));
const settingsOf = page => page.evaluate(() => __biliThreadRipperDebug.getSettings());

(async () => {
  checkFile();
  const browser = await chromium.launch(chromeLaunchOptions());
  const origin = "http://127.0.0.1:18763/dev/userscript-test.html";
  const errors = [];
  const red = '.bubble[data-level="error"]:not(.leaving)';
  try {
    const context = await browser.newContext({ viewport: { width: 1100, height: 900 } });
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(origin);
    const stored = (target = page) => target.evaluate(() => JSON.parse(localStorage.getItem("BTR_Userscript.sync") || "{}"));

    // First run shows the same welcome panel as the extension, with the 0.9.1.2 defaults.
    const welcome = page.locator("#__bilibili_thread_ripper_onboarding__");
    await welcome.waitFor();
    assert.equal(await welcome.locator('input[name="btr-onboarding-mode"]:checked').getAttribute("value"), "mainland");
    assert.equal(await welcome.locator(".btr-onboarding-thread-value").textContent(), "8");
    await welcome.locator(".btr-onboarding-save").click();
    await welcome.waitFor({ state: "detached" });
    const saved = await stored();
    assert.deepEqual([saved.enabled, saved.mode, saved.concurrency, saved.errorNotices, saved.debugNotices], [true, "mainland", 8, false, false]);
    assert.equal(await page.evaluate(() => window.chrome?.storage), undefined, "the page's own chrome object must stay untouched");
    // The player menu keeps only what the extension puts there.
    const menu = page.locator("#__bilibili_thread_ripper_native_settings__");
    await menu.waitFor({ state: "attached" });
    assert.deepEqual(await menu.locator(".btr-native-setting-title").allTextContents(), ["线程撕裂者 CDN", "并发线程", "兼容模式"]);
    console.log("PASS 首次打开显示欢迎设置；播放器菜单保持扩展原样");

    // The menu command opens the extension's sidebar page inside the bilibili page.
    await openSettings(page);
    const panel = page.locator(`${settingsHost} .btr-popup`);
    await panel.waitFor();
    assert.equal(await panel.locator("h1").textContent(), "线程撕裂者");
    assert.equal(await panel.locator("#enabled").isChecked(), true);
    assert.equal(await panel.locator('input[name="mode"][value="mainland"]').isChecked(), true);
    assert.equal(await panel.locator('input[name="compatibility-mode"][value="off"]').isChecked(), true);
    assert.equal(await panel.locator("#thread-value").textContent(), "8");
    assert.equal(await panel.locator("#error-notices").isChecked(), false);
    assert.equal(await panel.locator("#debug-filters").isVisible(), false);
    await page.waitForFunction(() => __userscriptTest.statusRequests > 0);
    assert.match(await panel.locator("#active-count").textContent(), /^\d+$/);
    await page.evaluate(() => __BTR_RUNTIME_NOTICES__.log("默认不显示的错误", "显示错误关闭", "error"));
    await page.waitForTimeout(600);
    assert.equal(await page.locator(".bubble").count(), 0);
    await panel.locator("#error-notices").check();
    await page.waitForFunction(() => __biliThreadRipperDebug.getSettings().errorNotices === true);
    await page.evaluate(() => __BTR_RUNTIME_NOTICES__.log("打开后显示的错误", "这一小段没能下载下来", "error"));
    await page.locator(red).first().waitFor();
    await panel.locator("#concurrency").fill("2");
    await page.waitForFunction(() => __biliThreadRipperDebug.getSettings().concurrency === 16);
    assert.equal(await panel.locator("#thread-value").textContent(), "16");
    await panel.locator("#debug-notices").check();
    await panel.locator("#debug-filters").waitFor();
    assert.equal(await panel.locator("[data-debug-category]:checked").count(), 6);
    await page.locator(".mode").first().waitFor();
    console.log("PASS 设置页就是扩展侧边栏：开关、线程、Debug 分类和实时线程数都能用");

    // Closing stops the status polling; opening again starts clean.
    await page.keyboard.press("Escape");
    await page.locator(settingsHost).waitFor({ state: "detached" });
    const requests = await page.evaluate(() => __userscriptTest.statusRequests);
    await page.waitForTimeout(1000);
    assert.equal(await page.evaluate(() => __userscriptTest.statusRequests), requests, "no polling after close");
    await openSettings(page);
    await panel.waitFor();
    assert.equal(await panel.locator("#error-notices").isChecked(), true);
    assert.equal(await panel.locator("#thread-value").textContent(), "16");
    await openSettings(page);
    await page.locator(settingsHost).waitFor({ state: "detached" });
    await openSettings(page);
    await page.locator(`${settingsHost} .btr-backdrop`).click({ position: { x: 20, y: 20 } });
    await page.locator(settingsHost).waitFor({ state: "detached" });
    console.log("PASS 菜单再点一次、Esc、点空白处都能关闭，关闭后不再轮询");

    // A second tab follows changes and a reload keeps them.
    const second = await context.newPage();
    second.on("pageerror", error => errors.push(error.message));
    await second.goto(origin);
    await second.waitForFunction(() => window.__biliThreadRipperDebug?.getSettings().concurrency === 16);
    assert.equal(await second.locator("#__bilibili_thread_ripper_onboarding__").count(), 0);
    await openSettings(second);
    const secondPanel = second.locator(`${settingsHost} .btr-popup`);
    await secondPanel.waitFor();
    await secondPanel.locator('input[name="mode"][value="overseas"]').check({ force: true });
    await page.waitForFunction(() => __biliThreadRipperDebug.getSettings().mode === "overseas");
    await page.goto(origin);
    await page.waitForFunction(() => window.__biliThreadRipperDebug?.getSettings().mode === "overseas");
    assert.deepEqual(await settingsOf(page).then(value => [value.concurrency, value.errorNotices, value.debugNotices]), [16, true, true]);
    console.log("PASS 另一个标签页同步设置，刷新后设置保留，不再弹欢迎设置");

    // A manager that runs the script outside the page: the accelerator is injected into the
    // page once and the manager's menu entry opens the same settings page.
    const isolated = await (await browser.newContext()).newPage();
    isolated.on("pageerror", error => errors.push(error.message));
    await isolated.goto(`${origin}?mode=sandbox`);
    await isolated.waitForFunction(() => window.__biliThreadRipperDebug && document.documentElement.hasAttribute("data-btr-userscript"));
    assert.deepEqual(await isolated.evaluate(() => [__userscriptTest.injected, __userscriptTest.menus.map(item => item.name)]), [1, ["线程撕裂者设置"]]);
    await isolated.evaluate(() => __userscriptTest.menus[0].callback());
    await isolated.locator(`${settingsHost} .btr-popup`).waitFor();
    await isolated.evaluate(() => __userscriptTest.menus[0].callback());
    await isolated.locator(settingsHost).waitFor({ state: "detached" });
    assert.equal(await isolated.locator("#__btr_notification_stack__").count() <= 1, true);
    console.log("PASS 油猴在独立环境运行时：核心只注入页面一次，油猴菜单“线程撕裂者设置”能打开和关闭设置页");

    assert.deepEqual(errors, []);
    console.log("PASS 没有脚本错误");
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
