"use strict";
// 版本号原来散在 manifest、page-hook、bridge、README 和油猴脚本里手改，漂了不会有人发现。
// manifest.json 是唯一来源，其余地方必须跟上。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const version = JSON.parse(read("manifest.json")).version;

test("manifest 的版本号格式正确", () => {
  assert.match(version, /^\d+\.\d+\.\d+(?:\.\d+)?$/);
});

test("src 里写死的版本号和 manifest 一致", () => {
  // 扫整个 src/：0.9.1.4 之前这里只检查 page-hook.js，native-mse-player.js 里的那处一直漏网。
  let found = 0;
  for (const file of fs.readdirSync(path.join(root, "src")).filter((name) => name.endsWith(".js"))) {
    for (const match of read(`src/${file}`).matchAll(/(?:version: |VERSION = )"(\d+(?:\.\d+)+)"/g)) {
      found += 1;
      assert.equal(match[1], version, `src/${file} 里的版本号和 manifest 不一致`);
    }
  }
  assert.ok(found >= 4, `src 下应该至少有 4 处版本号，实际找到 ${found} 处`);
});

test("README 写的当前版本和 manifest 一致", () => {
  const heading = /当前版本：`(\d+(?:\.\d+)+)`/.exec(read("README.md"));
  assert.ok(heading, "README 里应该有“当前版本：`x.y.z`”");
  assert.equal(heading[1], version);
});

test("已提交的油猴脚本是当前 src 构建出来的", () => {
  const userscript = read("user_scripts/bilibili-thread-ripper.user.js");
  assert.match(userscript, new RegExp(`// @version\\s+${version.replace(/\./g, "\\.")}\\n`));
  // 构建脚本按 manifest 的顺序拼接 content_scripts，缺文件就说明忘了重新生成。
  for (const group of JSON.parse(read("manifest.json")).content_scripts) {
    for (const file of group.js) {
      assert.ok(userscript.includes(`/* ${file} */`), `油猴脚本里缺少 ${file}，请重新运行 scripts/build-userscript.ps1`);
    }
  }
});

test("manifest 引用的文件都存在", () => {
  const manifest = JSON.parse(read("manifest.json"));
  const files = [
    manifest.background.service_worker,
    manifest.side_panel.default_path,
    ...Object.values(manifest.icons),
    ...manifest.content_scripts.flatMap((group) => group.js)
  ];
  for (const file of files) {
    assert.ok(fs.existsSync(path.join(root, file)), `manifest 引用了不存在的文件 ${file}`);
  }
});

test("src 里没有 manifest 不加载的孤儿脚本", () => {
  const manifest = JSON.parse(read("manifest.json"));
  const loaded = new Set([
    manifest.background.service_worker.replace(/^src\//, ""),
    ...manifest.content_scripts.flatMap((group) => group.js).map((file) => file.replace(/^src\//, ""))
  ]);
  const orphans = fs.readdirSync(path.join(root, "src")).filter((file) => file.endsWith(".js") && !loaded.has(file));
  assert.deepEqual(orphans, [], `这些文件没有被 manifest 加载：${orphans.join("、")}`);
});
