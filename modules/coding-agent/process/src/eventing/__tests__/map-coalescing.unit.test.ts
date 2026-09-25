import { CODING_AGENT_MAP_COALESCE_MAX_BATCH } from "@langwatch/coding-agent-contract";
import type { CodingAgentProjectionPersistence } from "@langwatch/coding-agent-contract";
import { describe, expect, it } from "vitest";

import {
  EventingCodingAgentTraceSessionAppendService,
  EventingSessionMetricSeriesAppendService,
} from "../../services/coding-agent-projection-append.service.ts";
import { CodingAgentTraceSessionsMapProjection } from "../coding-agent-trace-sessions.projection.ts";
import { SessionMetricSeriesMapProjection } from "../session-metric-series.projection.ts";

const persistence = {
  storeSession: async () => void 0,
  storeSessionBatch: async () => void 0,
  loadSessionWithApplied: async () => null,
  appendTraceSessions: async () => void 0,
  appendMetricSeries: async () => void 0,
  appendSessionEvents: async () => void 0,
} satisfies CodingAgentProjectionPersistence;

/**
 * A backed-up group without coalescing pays one append per queued event — the
 * O(n²) drain pattern this pipeline showed during the 2026-07-31 backlog
 * (~90 busy slots). Pins the batch ceiling so a refactor can't drop it to 1.
 */
describe("coding-agent map coalescing", () => {
  describe("when the trace-sessions map projection is constructed", () => {
    it("declares the shared map coalesce ceiling", () => {
      const projection = CodingAgentTraceSessionsMapProjection.create({
        store: EventingCodingAgentTraceSessionAppendService.create({
          persistence,
          defaultRetentionDays: () => 365,
        }),
      });
      expect(projection.options?.coalesceMaxBatch).toBe(CODING_AGENT_MAP_COALESCE_MAX_BATCH);
    });

    it("backs the ceiling with a bulkAppend-capable store", () => {
      const store = EventingCodingAgentTraceSessionAppendService.create({
        persistence,
        defaultRetentionDays: () => 365,
      });
      expect(typeof store.bulkAppend).toBe("function");
    });
  });

  describe("when the session-metric-series map projection is constructed", () => {
    it("declares the shared map coalesce ceiling", () => {
      const projection = SessionMetricSeriesMapProjection.create({
        store: EventingSessionMetricSeriesAppendService.create({
          persistence,
          defaultRetentionDays: () => 365,
        }),
      });
      expect(projection.options?.coalesceMaxBatch).toBe(CODING_AGENT_MAP_COALESCE_MAX_BATCH);
    });
  });
});
