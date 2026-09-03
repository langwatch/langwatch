import { describe, expect, it } from "vitest";
import { MAX_SPAN_SHARD_COUNT, spanCommandGroupKey } from "../trace-span-command-shard.rules";

const TRACE_ID = "534bd8a1bf83e7c58e8aaacefb047cc2";

describe("spanCommandGroupKey", () => {
  describe("given sharding is enabled", () => {
    it("spreads a trace's spans across more than one group", () => {
      const groups = new Set(
        Array.from({ length: 64 }, (_, i) =>
          spanCommandGroupKey({
            traceId: TRACE_ID,
            spanId: (i + 1).toString(16).padStart(16, "0"),
            shardCount: 8,
          }),
        ),
      );
      expect(groups.size).toBeGreaterThan(1);
      for (const key of groups) {
        expect(key.startsWith(`${TRACE_ID}:`)).toBe(true);
      }
    });

    it("routes the same span to the same group every time", () => {
      const key = () =>
        spanCommandGroupKey({ traceId: TRACE_ID, spanId: "0a1b2c3d4e5f6071", shardCount: 8 });
      expect(key()).toBe(key());
    });

    it("clamps the derived shard index into range", () => {
      for (let i = 0; i < 256; i++) {
        const key = spanCommandGroupKey({
          traceId: TRACE_ID,
          spanId: (i + 1).toString(16).padStart(16, "0"),
          shardCount: MAX_SPAN_SHARD_COUNT,
        });
        const shard = Number(key.slice(key.lastIndexOf(":") + 1));
        expect(shard).toBeLessThan(MAX_SPAN_SHARD_COUNT);
      }
    });
  });

  describe("given sharding is disabled", () => {
    /** @scenario "The pipeline preserves the trace-only key when sharding is off" */
    it("returns the bare trace id, identical to the historic key", () => {
      expect(spanCommandGroupKey({ traceId: TRACE_ID, spanId: "abc", shardCount: 1 })).toBe(
        TRACE_ID,
      );
    });
  });

  describe("given non-OTel-compliant trace and span ids", () => {
    it("still derives a stable sharded group for arbitrary string ids", () => {
      const weirdTrace = "my-custom::trace/id";
      const weirdSpan = "span_ABC!@# 123";
      const key = spanCommandGroupKey({ traceId: weirdTrace, spanId: weirdSpan, shardCount: 8 });
      expect(key.startsWith(`${weirdTrace}:`)).toBe(true);
      expect(spanCommandGroupKey({ traceId: weirdTrace, spanId: weirdSpan, shardCount: 8 })).toBe(
        key,
      );
    });
  });
});
