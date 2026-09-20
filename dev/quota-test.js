(async function runQuotaTest(root) {
  "use strict";

  // 0.9.1.4 之前：prune() 要等 video.currentTime >= 75 才开始回收，前 75 秒一点不清理；高码率
  // 视频在那之前就把 SourceBuffer 撑爆，appendBuffer 抛 QuotaExceededError，被 fillTrack 的
  // catch 当成致命错误，接管直接死掉。这个用例盯三件事：
  //   1. 撞到配额不能变成致命错误；
  //   2. 腾空间用的 remove 不能和 append 自己的串行队列死锁；
  //   3. 暂时写不进去的分段不能被跳过，否则播放会出现空洞。
  const fixture = root.__BTR_QUOTA_FIXTURE__;
  const result = document.getElementById("quota-result");
  const container = document.querySelector(".bpx-player-container");
  const video = container.querySelector("video");
  const failures = [];
  const unhandled = [];
  root.addEventListener("unhandledrejection", (event) => unhandled.push(String(event.reason?.message || event.reason)));

  // 真实 <video> 不会去播一个假的 blob 地址，所以播放位置由测试自己推进。
  let clock = 0;
  Object.defineProperty(video, "currentTime", {
    configurable: true,
    get: () => clock,
    set: (value) => { clock = Math.max(0, Number(value) || 0); }
  });

  const settings = { enabled: true, mode: "mainland", concurrency: 8 };
  const player = root.__BILI_NATIVE_MSE_PLAYER_FACTORY__.createNativePlayer({
    container,
    identity: { bvid: "BV1quotaTest1", part: 1 },
    playinfo: fixture.playinfo,
    initialTime: 0,
    initialResume: false,
    getSettings: () => settings,
    nativeFetch: root.fetch.bind(root),
    onFatal(error) { failures.push(String(error?.message || error)); },
    onState() {},
    onLog() {}
  });

  const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const report = fixture.report;

  // 1. 从 0 秒开始灌，很快就会撞上假 SourceBuffer 的 10 MiB 上限。
  await settle(1500);
  const quotaHitsBeforePlayback = report.quotaHits;
  const appendedBeforePlayback = report.appended.slice();

  // 2. 推进播放位置，prune 应该回收播过的部分，之前放不下的分段要补上。
  for (let step = 0; step < 12; step += 1) {
    clock += fixture.SEGMENT_SECONDS;
    video.dispatchEvent(new Event("timeupdate"));
    await settle(220);
  }
  await settle(600);

  const appended = report.appended;
  const gaps = [];
  for (let index = 1; index < appended.length; index += 1) {
    if (appended[index] !== appended[index - 1] + 1) gaps.push(`${appended[index - 1]}→${appended[index]}`);
  }

  player.destroy({ resumeNative: false });
  await settle(200);

  const output = {
    quotaHitsBeforePlayback,
    totalQuotaHits: report.quotaHits,
    appendedBeforePlayback: appendedBeforePlayback.length,
    appendedTotal: appended.length,
    lastAppendedSegment: appended.length ? appended[appended.length - 1] : -1,
    appendsAfterQuota: report.appendsAfterQuota,
    removeCount: report.removes.length,
    gaps,
    failures,
    unhandled
  };

  output.pass =
    // 配额确实被撞到了，否则这个用例什么都没测到
    output.quotaHitsBeforePlayback > 0
    // 撞配额不能变成致命错误
    && output.failures.length === 0
    // 腾空间的 remove 真的发生了，而且没有死锁（死锁的话后面一段都写不进去）
    && output.removeCount > 0
    && output.appendsAfterQuota > 0
    // 播放推进之后补上了更多分段
    && output.appendedTotal > output.appendedBeforePlayback
    // 分段序号必须连续，跳号就等于播放空洞
    && output.gaps.length === 0
    && output.unhandled.length === 0;

  result.textContent = JSON.stringify(output);
  result.dataset.pass = String(output.pass);
})(globalThis);
