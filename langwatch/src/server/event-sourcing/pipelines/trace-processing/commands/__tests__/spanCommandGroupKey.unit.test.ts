import { describe, expect, it } from "vitest";
import {
  MAX_SPAN_SHARD_COUNT,
  resolveSpanCommandShardCount,
  spanCommandGroupKey,
  spanShardIndex,
} from "../spanCommandGroupKey";

const TRACE_ID = "534bd8a1bf83e7c58e8aaacefb047cc2";

/** 64 distinct hex span ids, shaped like real OTLP span ids. */
function makeSpanIds(n: number): string[] {
  return Array.from({ length: n }, (_, i) =>
    (i + 1).toString(16).padStart(16, "0"),
  );
}

describe("spanCommandGroupKey", () => {
  describe("given sharding is disabled", () => {
    describe("when the shard count is one, zero, or negative", () => {
      /** @scenario "Sharding disabled keeps the historic trace-only group key" */
      it("returns the bare trace id, identical to the historic key", () => {
        for (const shardCount of [1, 0, -4]) {
          expect(
            spanCommandGroupKey({
              traceId: TRACE_ID,
              spanId: "abc",
              shardCount,
            }),
          ).toBe(TRACE_ID);
        }
      });

      it("returns the same key for every span of the trace", () => {
        const keys = makeSpanIds(20).map((spanId) =>
          spanCommandGroupKey({ traceId: TRACE_ID, spanId, shardCount: 1 }),
        );
        expect(new Set(keys)).toEqual(new Set([TRACE_ID]));
      });
    });
  });

  describe("given sharding is enabled", () => {
    describe("when deriving a key for a span", () => {
      it("prefixes the trace id and suffixes a shard within range", () => {
        const key = spanCommandGroupKey({
          traceId: TRACE_ID,
          spanId: "00000000000000ff",
          shardCount: 8,
        });
        const [prefix, shard] = key.split(":");
        expect(prefix).toBe(TRACE_ID);
        expect(Number(shard)).toBeGreaterThanOrEqual(0);
        expect(Number(shard)).toBeLessThan(8);
      });

      /** @scenario "A span always maps to the same shard" */
      it("derives the same group for the same span every time", () => {
        const spanId = "0a1b2c3d4e5f6071";
        const first = spanCommandGroupKey({
          traceId: TRACE_ID,
          spanId,
          shardCount: 16,
        });
        const second = spanCommandGroupKey({
          traceId: TRACE_ID,
          spanId,
          shardCount: 16,
        });
        expect(second).toBe(first);
      });
    });

    describe("when deriving keys for many spans of one trace", () => {
      /** @scenario "Sharding spreads a trace's spans across groups" */
      it("spreads them across more than one group", () => {
        const groups = new Set(
          makeSpanIds(64).map((spanId) =>
            spanCommandGroupKey({ traceId: TRACE_ID, spanId, shardCount: 16 }),
          ),
        );
        expect(groups.size).toBeGreaterThan(1);
      });

      it("uses every shard for a well-distributed span population", () => {
        const shardCount = 8;
        const seen = new Set(
          makeSpanIds(512).map((spanId) =>
            spanShardIndex({ spanId, shardCount }),
          ),
        );
        expect(seen.size).toBe(shardCount);
      });

      it("keeps every derived shard within [0, shardCount)", () => {
        const shardCount = 16;
        for (const spanId of makeSpanIds(256)) {
          const shard = spanShardIndex({ spanId, shardCount });
          expect(shard).toBeGreaterThanOrEqual(0);
          expect(shard).toBeLessThan(shardCount);
        }
      });
    });

    describe("when two different spans of the same trace are keyed", () => {
      it("keeps the trace prefix shared so both remain the same aggregate", () => {
        const a = spanCommandGroupKey({
          traceId: TRACE_ID,
          spanId: "1111111111111111",
          shardCount: 16,
        });
        const b = spanCommandGroupKey({
          traceId: TRACE_ID,
          spanId: "2222222222222222",
          shardCount: 16,
        });
        expect(a.startsWith(`${TRACE_ID}:`)).toBe(true);
        expect(b.startsWith(`${TRACE_ID}:`)).toBe(true);
      });
    });
  });

  describe("given non-OTel-compliant trace or span ids", () => {
    // Span/trace ids are normalized to strings before this helper, but nothing
    // forces them to be 16-char hex — a customer SDK can send arbitrary strings.
    // The FNV hash consumes any string, so bucketing stays total and stable.
    const NON_OTEL_SPAN_IDS = [
      "not-hex-at-all",
      "span_ABC!@#$%^&*()",
      "550e8400-e29b-41d4-a716-446655440000",
      "スパン-🚀-id",
      " leading-and-trailing ",
      "x".repeat(4096),
      "",
    ];

    describe("when a non-OTel span id is sharded", () => {
      it("returns a deterministic integer bucket within [0, shardCount)", () => {
        const shardCount = 12;
        for (const spanId of NON_OTEL_SPAN_IDS) {
          const bucket = spanShardIndex({ spanId, shardCount });
          expect(Number.isInteger(bucket)).toBe(true);
          expect(bucket).toBeGreaterThanOrEqual(0);
          expect(bucket).toBeLessThan(shardCount);
          expect(spanShardIndex({ spanId, shardCount })).toBe(bucket);
        }
      });

      it("keeps the trace prefix on the derived `traceId:<shard>` key", () => {
        for (const spanId of NON_OTEL_SPAN_IDS) {
          const key = spanCommandGroupKey({
            traceId: TRACE_ID,
            spanId,
            shardCount: 8,
          });
          expect(key.startsWith(`${TRACE_ID}:`)).toBe(true);
        }
      });
    });

    describe("when the trace id itself is non-OTel-compliant", () => {
      it("preserves the raw trace id verbatim when sharding is disabled", () => {
        for (const traceId of [
          "my-custom::trace/id",
          "550e8400-e29b-41d4-a716-446655440000",
          "",
        ]) {
          expect(
            spanCommandGroupKey({ traceId, spanId: "any", shardCount: 1 }),
          ).toBe(traceId);
        }
      });

      it("keeps distinct traces in distinct groups even when a trace id contains a colon", () => {
        // "always suffix when enabled" stops a colon-bearing trace id from
        // colliding with another trace's `traceId:<shard>` group. Same spanId so
        // the shard suffix matches — only the trace prefix differs.
        const plain = spanCommandGroupKey({
          traceId: "abc",
          spanId: "s",
          shardCount: 8,
        });
        const colon = spanCommandGroupKey({
          traceId: "abc:0",
          spanId: "s",
          shardCount: 8,
        });
        expect(colon).not.toBe(plain);
      });
    });
  });
});

describe("resolveSpanCommandShardCount", () => {
  describe("given an absent, non-numeric, or below-one value", () => {
    it("falls back to one so sharding stays disabled", () => {
      for (const raw of [undefined, "", "abc", "0", "-3", "2.5", "NaN"]) {
        expect(resolveSpanCommandShardCount(raw)).toBe(1);
      }
    });
  });

  describe("given a valid in-range value", () => {
    it("returns the parsed integer", () => {
      expect(resolveSpanCommandShardCount("16")).toBe(16);
    });
  });

  describe("given a value above the maximum", () => {
    /** @scenario "The configured shard count is clamped to a safe range" */
    it("clamps down to the maximum", () => {
      expect(resolveSpanCommandShardCount("100000")).toBe(MAX_SPAN_SHARD_COUNT);
    });
  });
});
