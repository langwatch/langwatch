import { describe, expect, it } from "vitest";
import { CODING_AGENT_MAP_COALESCE_MAX_BATCH } from "@langwatch/coding-agent-contract";
import { CodingAgentTraceSessionsMapProjection } from "../../src/projections/coding-agent-trace-sessions.projection";
import { SessionMetricSeriesMapProjection } from "../../src/projections/session-metric-series.projection";
import {
  EventingCodingAgentTraceSessionAppendAdapter,
  EventingSessionMetricSeriesAppendAdapter,
} from "../../src/adapters/eventing.coding-agent-projections.adapter";
import type { CodingAgentProjectionPersistence } from "@langwatch/coding-agent-contract";

const persistence = {
  storeSession: async () => void 0,
  storeSessionBatch: async () => void 0,
  loadSessionWithApplied: async () => null,
  appendTraceSessions: async () => void 0,
  appendMetricSeries: async () => void 0,
  appendSessionEvents: async () => void 0,
} satisfies CodingAgentProjectionPersistence;

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
      const projection = CodingAgentTraceSessionsMapProjection.create({
        store: EventingCodingAgentTraceSessionAppendAdapter.create({
          persistence,
          defaultRetentionDays: 365,
        }),
      });
      expect(projection.options?.coalesceMaxBatch).toBe(CODING_AGENT_MAP_COALESCE_MAX_BATCH);
    });

    it("backs the ceiling with a bulkAppend-capable store", () => {
      const store = EventingCodingAgentTraceSessionAppendAdapter.create({
        persistence,
        defaultRetentionDays: 365,
      });
      expect(typeof store.bulkAppend).toBe("function");
    });
  });

  describe("when the session-metric-series map projection is constructed", () => {
    it("declares the shared map coalesce ceiling", () => {
      const projection = SessionMetricSeriesMapProjection.create({
        store: EventingSessionMetricSeriesAppendAdapter.create({
          persistence,
          defaultRetentionDays: 365,
        }),
      });
      expect(projection.options?.coalesceMaxBatch).toBe(CODING_AGENT_MAP_COALESCE_MAX_BATCH);
    });
  });
});
