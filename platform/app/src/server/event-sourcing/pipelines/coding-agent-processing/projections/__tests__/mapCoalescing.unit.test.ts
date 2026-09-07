import { describe, expect, it } from "vitest";
import { CODING_AGENT_MAP_COALESCE_MAX_BATCH } from "../../schemas/constants";
import { CodingAgentTraceSessionsMapProjection } from "../codingAgentTraceSessions.mapProjection";
import { SessionMetricSeriesMapProjection } from "../sessionMetricSeries.mapProjection";
import {
  CodingAgentTraceSessionAppendStore,
  SessionMetricSeriesAppendStore,
} from "../stores";

/**
 * A backed-up group without coalescing pays one append per queued event —
 * the O(n²) drain pattern this pipeline's maps showed during the 2026-07-31
 * backlog (one-event-per-job at ~90 busy slots). These tests pin the batch
 * ceiling so a refactor cannot silently drop the option back to the
 * framework default of 1.
 */
describe("coding-agent map coalescing", () => {
  describe("when the trace-sessions map projection is constructed", () => {
    it("declares the shared map coalesce ceiling", () => {
      const projection = new CodingAgentTraceSessionsMapProjection({
        store: new CodingAgentTraceSessionAppendStore({
          insertMany: async () => undefined,
        } as never),
      });
      expect(projection.options?.coalesceMaxBatch).toBe(
        CODING_AGENT_MAP_COALESCE_MAX_BATCH,
      );
    });

    it("backs the ceiling with a bulkAppend-capable store", () => {
      const store = new CodingAgentTraceSessionAppendStore({
        insertMany: async () => undefined,
      } as never);
      expect(typeof store.bulkAppend).toBe("function");
    });
  });

  describe("when the session-metric-series map projection is constructed", () => {
    it("declares the shared map coalesce ceiling", () => {
      const projection = new SessionMetricSeriesMapProjection({
        store: new SessionMetricSeriesAppendStore({
          insertMany: async () => undefined,
        } as never),
      });
      expect(projection.options?.coalesceMaxBatch).toBe(
        CODING_AGENT_MAP_COALESCE_MAX_BATCH,
      );
    });
  });
});
