import { describe, expect, it } from "vitest";
import { buildCollectorPayload, type TraceFixture } from "../seed-primitives";

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
