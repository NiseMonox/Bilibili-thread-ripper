"use strict";
// bufferPlan 决定每条轨道缓冲多少秒。原来写死 45 秒，1080P 没问题，4K 高码率会把 Chrome 的
// SourceBuffer 配额撑爆，appendBuffer 抛 QuotaExceededError，接管直接死掉。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const SOURCE = path.join(__dirname, "..", "src");

function load() {
  const context = vm.createContext({
    URL, AbortController, DOMException, Uint8Array, Promise, setTimeout, clearTimeout, performance, console,
    // 安装时只检查这几个全局在不在，bufferPlan 本身不碰它们。
    MediaSource: { isTypeSupported: () => true },
    MutationObserver: class { observe() {} disconnect() {} },
    document: { getElementById: () => null, createElement: () => ({ style: {}, append() {} }), head: null, documentElement: null }
  });
  context.globalThis = context;
  for (const file of ["range-core.js", "sidx.js", "cdn-resolver.js", "idm-downloader.js", "native-mse-player.js"]) {
    vm.runInContext(fs.readFileSync(path.join(SOURCE, file), "utf8"), context, { filename: file });
  }
  return context.__BILI_NATIVE_MSE_PLAYER_FACTORY__;
}

const MiB = 1024 * 1024;
const bytesPerSecond = (megabitsPerSecond) => megabitsPerSecond * 1e6 / 8;

test("普通码率保持原来的 45 秒缓冲", () => {
  const { bufferPlan } = load();
  for (const rate of [2, 5, 8]) {
    const plan = bufferPlan("video", bytesPerSecond(rate), 45);
    assert.equal(plan.ahead, 45, `${rate} Mbps 不应该被压低`);
    assert.equal(plan.keepBehind, 20);
  }
});

test("高码率按预算压低缓冲，总量不超过 Chrome 的配额", () => {
  const { bufferPlan } = load();
  for (const rate of [20, 30, 45, 60]) {
    const speed = bytesPerSecond(rate);
    const plan = bufferPlan("video", speed, 45);
    assert.ok(plan.ahead < 45, `${rate} Mbps 应该被压低，实际 ${plan.ahead}`);
    assert.ok(plan.ahead >= 8, `${rate} Mbps 压得太狠会卡播放，实际 ${plan.ahead}`);
    // 保留窗口 + 前向缓冲一起算，必须离 Chrome 的 150 MiB 上限有余量。
    const worstCase = (plan.ahead + plan.keepBehind) * speed;
    assert.ok(worstCase < 120 * MiB, `${rate} Mbps 最坏情况 ${(worstCase / MiB).toFixed(0)} MiB 太接近上限`);
  }
});

test("码率越高缓冲越短，且保留窗口不会低于 5 秒", () => {
  const { bufferPlan } = load();
  const plans = [10, 20, 40, 80].map((rate) => bufferPlan("video", bytesPerSecond(rate), 45));
  for (let index = 1; index < plans.length; index += 1) {
    assert.ok(plans[index].ahead <= plans[index - 1].ahead, "码率更高时缓冲不应该变长");
    assert.ok(plans[index].keepBehind >= 5, "保留窗口不能小于 5 秒，否则刚播过的部分会被立刻丢掉");
  }
});

test("音频预算独立，正常码率不受影响", () => {
  const { bufferPlan } = load();
  for (const kilobits of [64, 132, 192, 320]) {
    assert.equal(bufferPlan("audio", kilobits * 1000 / 8, 45).ahead, 45, `${kilobits} kbps 音频不该被压低`);
  }
});

test("码率未知时退回请求值", () => {
  const { bufferPlan } = load();
  assert.equal(bufferPlan("video", 0, 45).ahead, 45);
  assert.equal(bufferPlan("video", NaN, 45).ahead, 45);
  assert.equal(bufferPlan("video", -1, 45).ahead, 45);
  assert.equal(bufferPlan("video", 0, 45).keepBehind, 20);
});
