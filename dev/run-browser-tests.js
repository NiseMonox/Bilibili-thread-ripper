"use strict";
// 浏览器侧的测试都要求 http://127.0.0.1:18763 上有 dev/server.js，原来得自己开一个终端跑。
// 这里负责起服务、等端口通、按顺序跑给定的测试、最后收掉服务。
const { spawn } = require("node:child_process");
const net = require("node:net");
const path = require("node:path");

const PORT = 18763;
const requested = process.argv.slice(2);
if (!requested.length) {
  console.error("用法：node dev/run-browser-tests.js <测试文件> [更多测试文件...]");
  process.exit(1);
}

function portIsOpen() {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port: PORT });
    const settle = (value) => {
      socket.destroy();
      resolve(value);
    };
    socket.once("connect", () => settle(true));
    socket.once("error", () => settle(false));
    socket.setTimeout(1000, () => settle(false));
  });
}

async function waitForServer(deadlineMs = 15000) {
  const until = Date.now() + deadlineMs;
  while (Date.now() < until) {
    if (await portIsOpen()) return true;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return false;
}

function run(file) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(__dirname, file)], { stdio: "inherit" });
    child.on("exit", (code) => resolve(code === 0));
  });
}

(async () => {
  const borrowed = await portIsOpen();
  let server = null;
  if (!borrowed) {
    server = spawn(process.execPath, [path.join(__dirname, "server.js")], { stdio: ["ignore", "inherit", "inherit"] });
    if (!(await waitForServer())) {
      server.kill();
      throw new Error(`dev/server.js 没能在 ${PORT} 端口上起来`);
    }
  } else {
    console.log(`复用已经在 ${PORT} 端口上运行的 dev/server.js`);
  }

  const failed = [];
  try {
    for (const file of requested) {
      console.log(`\n=== ${file} ===`);
      if (!(await run(file))) failed.push(file);
    }
  } finally {
    server?.kill();
  }

  if (failed.length) {
    console.error(`\n失败：${failed.join("、")}`);
    process.exitCode = 1;
  } else {
    console.log(`\n全部通过：${requested.join("、")}`);
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
