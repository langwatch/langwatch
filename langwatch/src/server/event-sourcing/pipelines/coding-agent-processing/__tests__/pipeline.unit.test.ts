import { describe, expect, it } from "vitest";
import { createCodingAgentProcessingPipeline } from "../pipeline";
import { FACTS_COMMAND_COALESCE_MAX_BATCH } from "../schemas/constants";

describe("coding-agent processing pipeline", () => {
  describe("when the contribution commands are registered on the real pipeline", () => {
    // ADR-066 pillar 2: the coalesce behavior itself (N contributions → one
    // insert) is proven at the GroupQueue layer; this pins each adopter's
    // opt-in so a regression to per-item inserts fails a test, not production.
    it("registers append coalescing on every contribution command", () => {
      const pipeline = createCodingAgentProcessingPipeline({
        codingAgentSessionStore: {} as never,
        codingAgentTraceSessionAppendStore: {} as never,
        sessionMetricSeriesAppendStore: {} as never,
      });

      for (const name of [
        "contributeSpanFacts",
        "contributeLogFacts",
        "contributeMetricFacts",
      ]) {
        const command = pipeline.commands.find(
          (candidate) => candidate.name === name,
        );
        expect(command?.options?.coalesceMaxBatch).toBe(
          FACTS_COMMAND_COALESCE_MAX_BATCH,
        );
        expect(command?.options?.coalesceMaxBatch).toBeGreaterThan(1);
      }
    });
  });
});
