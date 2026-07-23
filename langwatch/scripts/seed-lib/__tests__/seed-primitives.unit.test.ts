import { describe, expect, it } from "vitest";
import {
  buildCollectorPayload,
  requiredRetentionDays,
  type TraceFixture,
} from "../seed-primitives";

describe("requiredRetentionDays", () => {
  describe("given a seed window shorter than the floor", () => {
    // @scenario "Backdated history outlives the default retention horizon"
    it("pins a horizon that outlives the window with margin", () => {
      // Rows are stamped TTL = data time + retention days (platform default
      // 49), so a 90-day window's oldest rows must get well over 90.
      expect(requiredRetentionDays(90)).toBeGreaterThan(90 + 49);
      expect(requiredRetentionDays(90)).toBe(400);
    });
  });

  describe("given a window longer than the floor", () => {
    it("scales with the window instead of capping", () => {
      expect(requiredRetentionDays(400)).toBe(460);
    });
  });
});

describe("buildCollectorPayload", () => {
  const trace: TraceFixture = {
    traceId: "mass-trace-t",
    userId: "u",
    threadId: "th",
    input: "hi",
    output: "hello",
    model: "gpt-5-mini",
    latencyMs: 1_000,
    promptTokens: 10,
    completionTokens: 5,
    cost: 0.001,
    finishedAtMs: 1_750_000_000_000,
    metadata: { labels: ["mass-seed"] },
  };

  describe("when a fixture carries its own finish time", () => {
    it("back-computes span timestamps from latency and keeps both spans on the trace", () => {
      const payload = buildCollectorPayload(trace, 0);
      expect(payload.trace_id).toBe("mass-trace-t");
      expect(payload.spans).toHaveLength(2);
      expect(payload.spans[0]!.timestamps.started_at).toBe(
        1_750_000_000_000 - 1_000,
      );
      expect(payload.metadata.user_id).toBe("u");
      expect(payload.metadata.thread_id).toBe("th");
    });
  });
});
