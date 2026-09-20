(function installQuotaFakes(root) {
  "use strict";

  const SEGMENT_SECONDS = 4;
  const SEGMENT_BYTES = 2 * 1024 * 1024;
  const SEGMENT_COUNT = 60;
  // 浏览器真正的上限比插件自己的预算低得多，配额安全网就是为这种情况准备的。
  const SOURCE_BUFFER_QUOTA_BYTES = 10 * 1024 * 1024;
  const INIT_MARKER = 0xffffffff;

  const segments = Array.from({ length: SEGMENT_COUNT }, (_value, index) => ({
    index,
    start: index * SEGMENT_BYTES,
    end: (index + 1) * SEGMENT_BYTES - 1,
    length: SEGMENT_BYTES,
    startTime: index * SEGMENT_SECONDS,
    endTime: (index + 1) * SEGMENT_SECONDS,
    durationSeconds: SEGMENT_SECONDS
  }));

  // 每段数据的头 4 个字节写上自己的序号，假的 SourceBuffer 靠它知道这段对应哪个时间区间。
  function segmentBytes(index) {
    const bytes = new Uint8Array(SEGMENT_BYTES);
    new DataView(bytes.buffer).setUint32(0, index);
    return bytes;
  }
  function markerOf(bytes) {
    return bytes?.byteLength >= 4 ? new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0) : INIT_MARKER;
  }

  const report = {
    appended: [],
    quotaHits: 0,
    removes: [],
    appendsAfterQuota: 0
  };

  class FakeSourceBuffer extends EventTarget {
    constructor(mime) {
      super();
      this.mime = mime;
      this.kind = mime.startsWith("audio") ? "audio" : "video";
      this.updating = false;
      this.ranges = [];
      this.usedBytes = 0;
    }

    get buffered() {
      const ranges = this.ranges;
      return {
        length: ranges.length,
        start: (index) => ranges[index].start,
        end: (index) => ranges[index].end
      };
    }

    settle() {
      this.updating = true;
      setTimeout(() => {
        this.updating = false;
        this.dispatchEvent(new Event("updateend"));
      }, 0);
    }

    appendBuffer(bytes) {
      if (this.updating) throw new DOMException("still updating", "InvalidStateError");
      if (this.usedBytes + bytes.byteLength > SOURCE_BUFFER_QUOTA_BYTES) {
        if (this.kind === "video") report.quotaHits += 1;
        throw new DOMException(
          "Failed to execute 'appendBuffer' on 'SourceBuffer': The SourceBuffer is full, and cannot free space to append additional buffers.",
          "QuotaExceededError"
        );
      }
      this.usedBytes += bytes.byteLength;
      const marker = markerOf(bytes);
      if (marker !== INIT_MARKER) {
        const segment = segments[marker];
        if (this.kind === "video") {
          report.appended.push(marker);
          if (report.quotaHits) report.appendsAfterQuota += 1;
        }
        this.ranges.push({ start: segment.startTime, end: segment.endTime, bytes: bytes.byteLength });
        this.ranges.sort((left, right) => left.start - right.start);
        // 相邻区间合并，和真实 TimeRanges 的行为一致。
        for (let index = this.ranges.length - 1; index > 0; index -= 1) {
          if (this.ranges[index - 1].end >= this.ranges[index].start - 0.001) {
            this.ranges[index - 1].end = Math.max(this.ranges[index - 1].end, this.ranges[index].end);
            this.ranges[index - 1].bytes += this.ranges[index].bytes;
            this.ranges.splice(index, 1);
          }
        }
      }
      this.settle();
    }

    remove(start, end) {
      if (this.kind === "video") report.removes.push({ start, end });
      const kept = [];
      for (const range of this.ranges) {
        if (range.end <= start || range.start >= end) {
          kept.push(range);
          continue;
        }
        const overlap = Math.min(range.end, end) - Math.max(range.start, start);
        const freed = range.bytes * (overlap / (range.end - range.start));
        this.usedBytes = Math.max(0, this.usedBytes - freed);
        if (range.start < start) kept.push({ start: range.start, end: start, bytes: range.bytes - freed });
        if (range.end > end) kept.push({ start: end, end: range.end, bytes: range.bytes - freed });
      }
      this.ranges = kept.sort((left, right) => left.start - right.start);
      this.settle();
    }
  }

  class FakeMediaSource extends EventTarget {
    constructor() {
      super();
      this.readyState = "closed";
      this.duration = NaN;
      this.sourceBuffers = [];
      setTimeout(() => {
        this.readyState = "open";
        this.dispatchEvent(new Event("sourceopen"));
      }, 0);
    }
    static isTypeSupported() { return true; }
    addSourceBuffer(mime) {
      const buffer = new FakeSourceBuffer(mime);
      this.sourceBuffers.push(buffer);
      return buffer;
    }
    endOfStream() { this.readyState = "ended"; }
  }

  root.MediaSource = FakeMediaSource;
  root.URL.createObjectURL = () => `blob:btr-quota-test-${Math.random().toString(36).slice(2)}`;
  root.URL.revokeObjectURL = () => {};

  root.__BILI_SIDX__ = Object.freeze({
    parseSidx: () => ({ earliestPresentationTime: 0, firstOffset: 0, timescale: 1000, segments }),
    segmentIndexAt: (list, seconds) => Math.max(0, Math.min(list.length - 1, Math.floor((Number(seconds) || 0) / SEGMENT_SECONDS)))
  });

  const fakeResolver = Object.freeze({
    allows: () => true,
    failure() {},
    ordered: () => ["https://fake.bilivideo.com/a.m4s"],
    rangeCandidates: () => ["https://fake.bilivideo.com/a.m4s"],
    rescueCandidates: () => ["https://fake.bilivideo.com/a.m4s"],
    startupCandidates: () => ["https://fake.bilivideo.com/a.m4s"],
    status: () => [],
    success() {},
    urls: () => ["https://fake.bilivideo.com/a.m4s"]
  });
  root.__BILI_CDN_RESOLVER_FACTORY__ = Object.freeze({
    createResolver: () => fakeResolver,
    createBanList: () => ({ record: () => false, allows: () => true, hosts: () => [], reset() {} })
  });

  root.__BILI_IDM_DOWNLOADER_FACTORY__ = Object.freeze({
    createDownloader: () => Object.freeze({
      async downloadRange(range, _resolver, options = {}) {
        if (options.signal?.aborted) throw new DOMException("cancelled", "AbortError");
        if (options.kind === "meta") {
          const bytes = new Uint8Array(64);
          new DataView(bytes.buffer).setUint32(0, INIT_MARKER);
          return { bytes, byteLength: bytes.byteLength, pieceCount: 1, total: null, hosts: ["fake.bilivideo.com"] };
        }
        const index = Math.round(range.start / SEGMENT_BYTES);
        const bytes = segmentBytes(index);
        if (options.onOrderedChunk) await options.onOrderedChunk(bytes, range);
        options.onStartupScheduled?.();
        return {
          bytes: options.onOrderedChunk ? null : bytes,
          byteLength: bytes.byteLength,
          pieceCount: 4,
          streamed: Boolean(options.onOrderedChunk),
          total: SEGMENT_BYTES * SEGMENT_COUNT,
          hosts: ["fake.bilivideo.com"]
        };
      }
    })
  });

  const representation = (mimeType, codecs, bandwidth) => ({
    id: 120,
    mimeType,
    codecs,
    bandwidth,
    baseUrl: "https://fake.bilivideo.com/a.m4s",
    segment_base: { initialization: "0-63", index_range: "64-127" }
  });

  root.__BTR_QUOTA_FIXTURE__ = {
    report,
    segments,
    SEGMENT_SECONDS,
    SEGMENT_BYTES,
    SOURCE_BUFFER_QUOTA_BYTES,
    playinfo: {
      data: {
        quality: 120,
        dash: {
          duration: SEGMENT_COUNT * SEGMENT_SECONDS,
          video: [representation("video/mp4", "avc1.640028", SEGMENT_BYTES / SEGMENT_SECONDS * 8)],
          audio: [representation("audio/mp4", "mp4a.40.2", 132000)]
        }
      }
    }
  };
})(globalThis);
