import { describe, expect, it } from "vitest";
import {
  clampLogShardCount,
  DEFAULT_LOG_COMMAND_SHARD_COUNT,
  logCommandGroupKey,
  logShardIndex,
  MAX_LOG_SHARD_COUNT,
  resolveLogCommandShardCount,
} from "../logCommandGroupKey";

const TRACE_ID = "534bd8a1bf83e7c58e8aaacefb047cc2";

/** 64 distinct hex span ids, shaped like real OTLP span ids. */
function makeSpanIds(n: number): string[] {
  return Array.from({ length: n }, (_, i) =>
    (i + 1).toString(16).padStart(16, "0"),
  );
}

describe("logCommandGroupKey", () => {
  describe("given sharding is disabled", () => {
    describe("when the shard count is one, zero, or negative", () => {
      /** @scenario "one turn's logs fan out across ingest lanes" */
      it("returns the bare trace id, identical to the historic key", () => {
        for (const shardCount of [1, 0, -4]) {
          expect(
            logCommandGroupKey({
              traceId: TRACE_ID,
              spanId: "abc",
              shardCount,
            }),
          ).toBe(TRACE_ID);
        }
      });

      it("returns the same key for every log record of the trace", () => {
        const keys = makeSpanIds(20).map((spanId) =>
          logCommandGroupKey({ traceId: TRACE_ID, spanId, shardCount: 1 }),
        );
        expect(new Set(keys)).toEqual(new Set([TRACE_ID]));
      });
    });
  });

  describe("given sharding is enabled", () => {
    describe("when deriving a key for a log record", () => {
      it("prefixes the trace id and suffixes a shard within range", () => {
        const key = logCommandGroupKey({
          traceId: TRACE_ID,
          spanId: "00000000000000ff",
          shardCount: 8,
        });
        // Extract the suffix from the LAST colon so the assertion holds even for
        // a colon-bearing trace id (see the non-OTel cases below).
        const idx = key.lastIndexOf(":");
        const prefix = key.slice(0, idx);
        const shard = Number(key.slice(idx + 1));
        expect(prefix).toBe(TRACE_ID);
        expect(shard).toBeGreaterThanOrEqual(0);
        expect(shard).toBeLessThan(8);
      });

      it("derives the same group for the same span every time", () => {
        const spanId = "0a1b2c3d4e5f6071";
        const first = logCommandGroupKey({
          traceId: TRACE_ID,
          spanId,
          shardCount: 16,
        });
        const second = logCommandGroupKey({
          traceId: TRACE_ID,
          spanId,
          shardCount: 16,
        });
        expect(second).toBe(first);
      });
    });

    describe("when deriving keys for many log records of one trace", () => {
      /** @scenario "one turn's logs fan out across ingest lanes" */
      it("spreads them across more than one group", () => {
        const groups = new Set(
          makeSpanIds(64).map((spanId) =>
            logCommandGroupKey({ traceId: TRACE_ID, spanId, shardCount: 16 }),
          ),
        );
        expect(groups.size).toBeGreaterThan(1);
      });

      it("uses every shard for a well-distributed span population", () => {
        const shardCount = 8;
        const seen = new Set(
          makeSpanIds(512).map((spanId) =>
            logShardIndex({ spanId, shardCount }),
          ),
        );
        expect(seen.size).toBe(shardCount);
      });

      it("keeps every derived shard within [0, shardCount)", () => {
        const shardCount = 16;
        for (const spanId of makeSpanIds(256)) {
          const shard = logShardIndex({ spanId, shardCount });
          expect(shard).toBeGreaterThanOrEqual(0);
          expect(shard).toBeLessThan(shardCount);
        }
      });
    });

    describe("when two different log records of the same trace are keyed", () => {
      /** @scenario "one turn's logs fan out across ingest lanes" */
      it("keeps the trace prefix shared so both remain the same aggregate", () => {
        const a = logCommandGroupKey({
          traceId: TRACE_ID,
          spanId: "1111111111111111",
          shardCount: 16,
        });
        const b = logCommandGroupKey({
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
    // forces them to be 16-char hex - a customer SDK can send arbitrary strings.
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
          const bucket = logShardIndex({ spanId, shardCount });
          expect(Number.isInteger(bucket)).toBe(true);
          expect(bucket).toBeGreaterThanOrEqual(0);
          expect(bucket).toBeLessThan(shardCount);
          expect(logShardIndex({ spanId, shardCount })).toBe(bucket);
        }
      });

      it("falls back to a stable bucket for a missing span id", () => {
        // A log record with no span id still shards deterministically rather
        // than throwing on the ingest path.
        const shardCount = 8;
        const key = logCommandGroupKey({
          traceId: TRACE_ID,
          spanId: "",
          shardCount,
        });
        expect(key.startsWith(`${TRACE_ID}:`)).toBe(true);
        expect(
          logCommandGroupKey({ traceId: TRACE_ID, spanId: "", shardCount }),
        ).toBe(key);
      });

      it("keeps the trace prefix on the derived `traceId:<shard>` key", () => {
        for (const spanId of NON_OTEL_SPAN_IDS) {
          const key = logCommandGroupKey({
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
            logCommandGroupKey({ traceId, spanId: "any", shardCount: 1 }),
          ).toBe(traceId);
        }
      });

      it("keeps distinct traces in distinct groups even when a trace id contains a colon", () => {
        // "always suffix when enabled" stops a colon-bearing trace id from
        // colliding with another trace's `traceId:<shard>` group. Same spanId so
        // the shard suffix matches - only the trace prefix differs.
        const plain = logCommandGroupKey({
          traceId: "abc",
          spanId: "s",
          shardCount: 8,
        });
        const colon = logCommandGroupKey({
          traceId: "abc:0",
          spanId: "s",
          shardCount: 8,
        });
        expect(colon).not.toBe(plain);
      });
    });
  });
});

describe("resolveLogCommandShardCount", () => {
  describe("given an absent, non-numeric, or below-one value", () => {
    it("falls back to the on-by-default shard count", () => {
      for (const raw of [undefined, "", "abc", "0", "-3", "2.5", "NaN"]) {
        expect(resolveLogCommandShardCount(raw)).toBe(
          DEFAULT_LOG_COMMAND_SHARD_COUNT,
        );
      }
    });
  });

  describe("given an explicit one", () => {
    it("disables sharding", () => {
      expect(resolveLogCommandShardCount("1")).toBe(1);
    });
  });

  describe("given a valid in-range value", () => {
    it("returns the parsed integer", () => {
      expect(resolveLogCommandShardCount("16")).toBe(16);
    });
  });

  describe("given a value above the maximum", () => {
    it("clamps down to the maximum", () => {
      expect(resolveLogCommandShardCount("100000")).toBe(MAX_LOG_SHARD_COUNT);
    });
  });
});

describe("clampLogShardCount", () => {
  describe("given a non-integer or below-one count", () => {
    it("falls back to one, disabling sharding", () => {
      for (const n of [0, -5, 1.5, Number.NaN]) {
        expect(clampLogShardCount(n)).toBe(1);
      }
    });
  });

  describe("given an in-range count", () => {
    it("returns it unchanged", () => {
      expect(clampLogShardCount(16)).toBe(16);
    });
  });

  describe("given a count above the maximum", () => {
    it("clamps down to the maximum", () => {
      expect(clampLogShardCount(100_000)).toBe(MAX_LOG_SHARD_COUNT);
    });
  });
});
