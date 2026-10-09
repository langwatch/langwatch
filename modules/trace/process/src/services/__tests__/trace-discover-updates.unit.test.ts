import { aggregateProof, ownProof } from "@langwatch/authorization/testing";
import type { PresenceProjectEvent } from "@langwatch/presence-contract";
/**
 * A finished background discover refresh tells the tenant's open tabs to refetch.
 * @see modules/trace/specs/trace-tenant-broadcast-worker-composition.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { TraceListRead } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import { CLICKHOUSE_FACET_CATALOG } from "../../features/facet/repositories/clickhouse/clickhouse.trace-facet-registry.mapper.ts";
import { TraceListService } from "../../features/read/services/trace-list-read.service.ts";
import { MemoryTraceEvaluationRunsRepository } from "../../repositories/memory/memory.trace-evaluation-runs.repository.ts";

const TENANT = "tenant-discover-updates";
const NOW = 1_700_086_400_000;

function emptyRepository(): TraceListRead {
  return createApiFixture<TraceListRead>({
    findBatchedFacets: async () => ({ categoricals: {}, ranges: {} }),
    findCategoricalFacet: async () => ({ values: [], totalDistinct: 0 }),
    findCategoricalFacetRaw: async () => ({ values: [], totalDistinct: 0 }),
    findRangeStatsForTable: async () => ({ min: 0, max: 0 }),
    findDiscreteValues: async () => ({ values: [], distinctCount: 0 }),
  });
}

describe("the discover refresh push", () => {
  describe("given a tenant whose discover snapshot is cold", () => {
    /** @scenario "A finished discover refresh tells the tenant's tabs to refetch" */
    it("publishes main's discover_updated signal once the refresh lands", async () => {
      const published: PresenceProjectEvent[] = [];
      const updates = {
        publishProjectEvent: async (event: PresenceProjectEvent) => {
          published.push(event);
        },
      };
      const service = TraceListService.create({
        repository: emptyRepository(),
        evaluationRuns: MemoryTraceEvaluationRunsRepository.create(),
        topicNames: { findNamesByIds: async () => new Map() },
        facets: CLICKHOUSE_FACET_CATALOG,
        discoverUpdates: updates,
      });

      const first = await service.getDiscover({
        authorization: ownProof({ projectId: TENANT, now: NOW }),
        timeRange: { from: 1_700_000_000_000, to: 1_700_086_400_000 },
      });

      expect(first.pending).toBe(true);
      await vi.waitFor(() => expect(published).toHaveLength(1));
      const [signal] = published;
      expect(signal?.projectId).toBe(TENANT);
      expect(signal?.channel).toBe("discover_updated");
      expect(JSON.parse(signal?.event ?? "")).toEqual({
        event: "discover_updated",
        tenantId: TENANT,
        timestamp: expect.any(Number),
      });
    });
  });

  describe("given an aggregate project reading a shared member", () => {
    it("tells the aggregate's own tabs, never the member's", async () => {
      const published: PresenceProjectEvent[] = [];
      const service = TraceListService.create({
        repository: emptyRepository(),
        evaluationRuns: MemoryTraceEvaluationRunsRepository.create(),
        topicNames: { findNamesByIds: async () => new Map() },
        facets: CLICKHOUSE_FACET_CATALOG,
        discoverUpdates: {
          publishProjectEvent: async (event: PresenceProjectEvent) => {
            published.push(event);
          },
        },
      });

      await service.getDiscover({
        authorization: aggregateProof({
          projectId: "aggregate-discover-updates",
          members: [{ projectId: "member-discover-updates", from: 0 }],
          now: NOW,
        }),
        timeRange: { from: 1_700_000_000_000, to: NOW },
      });

      await vi.waitFor(() => expect(published).toHaveLength(1));
      expect(published[0]?.projectId).toBe("aggregate-discover-updates");
    });
  });
});
