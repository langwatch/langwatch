import { describe, expect, it } from "vitest";
import { createLogProcessingPipeline } from "../pipeline";
import { LOG_COMMAND_COALESCE_MAX_BATCH } from "../schemas/constants";

describe("log processing pipeline", () => {
  describe("when recordLogRecord is registered on the real pipeline", () => {
    // ADR-066 pillar 2: the coalesce behavior itself (N records → one insert)
    // is proven at the GroupQueue layer; this pins the adopter's opt-in so a
    // regression to per-record inserts fails a test, not production.
    it("registers append coalescing on the command lane", () => {
      const pipeline = createLogProcessingPipeline({
        canonicalLogAppendStore: {} as never,
        logCommandShardCount: 16,
      });
      const command = pipeline.commands.find(
        (candidate) => candidate.name === "recordLogRecord",
      );
      expect(command?.options?.coalesceMaxBatch).toBe(
        LOG_COMMAND_COALESCE_MAX_BATCH,
      );
      expect(command?.options?.coalesceMaxBatch).toBeGreaterThan(1);
    });
  });
});
