"use strict";
// Needs dev/server.js started with BTR_TEST_BVID and BTR_TEST_CID (real bilibili media).
// Runs native-mse-test.html with each video codec: startup, seek, and playing to the end.
const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const { chromeLaunchOptions } = require("./chrome-path.js");

const cases = [
  "",
  "?codec=hevc",
  "?codec=avc",
  "?codec=av1",
  // Browsers refuse a shorter duration once HEVC frames run past it. The end must not depend on it.
  "?codec=hevc&strictDuration=1",
  "?codec=av1&strictDuration=1"
];

(async () => {
  const browser = await chromium.launch(chromeLaunchOptions());
  let failed = false;
  try {
    for (let offset = 0; offset < cases.length; offset += 3) {
      const results = await Promise.allSettled(cases.slice(offset, offset + 3).map(async (query) => {
        const context = await browser.newContext();
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        try {
          await page.goto(`http://127.0.0.1:18763/dev/native-mse-test.html${query}`);
          const result = page.locator("#native-mse-result");
          await page.waitForFunction(() => document.getElementById("native-mse-result")?.dataset.pass, null, { timeout: 90000 });
          const output = JSON.parse(await result.innerText());
          assert.equal(output.pass, true, JSON.stringify(output));
          assert.deepEqual(errors, []);
          return `PASS ${query || "(默认编码)"}：${output.codec}，从 ${output.endTarget.toFixed(1)} 秒播到结尾 ${output.endDuration.toFixed(3)} 秒并正常结束`;
        } finally {
          await context.close();
        }
      }));
      for (const [index, result] of results.entries()) {
        if (result.status === "fulfilled") console.log(result.value);
        else { failed = true; console.error(`FAIL ${cases[offset + index] || "(默认编码)"}\n${result.reason?.message || result.reason}`); }
      }
    }
  } finally {
    await browser.close();
  }
  if (failed) process.exitCode = 1;
})().catch((error) => { console.error(error); process.exitCode = 1; });
