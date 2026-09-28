/**
 * A finished background discover refresh tells the tenant's open tabs to refetch.
 * @see modules/trace/specs/trace-tenant-broadcast-worker-composition.feature
 */
import { createApiFixture } from "@langwatch/api-fixture";
import type { EvaluationApi } from "@langwatch/evaluation-contract";
import type { TopicApi } from "@langwatch/topic-contract";
import type { TraceListRead } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import { MemoryTraceTenantBroadcastChannel } from "../../channels/memory/memory.trace-tenant-broadcast.channel.ts";
import { CLICKHOUSE_FACET_CATALOG } from "../../repositories/clickhouse/clickhouse.trace-facet-registry.mapper.ts";
import { TraceListService } from "../trace-list-read.service.ts";

const TENANT = "tenant-discover-updates";

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
      const updates = MemoryTraceTenantBroadcastChannel.create();
      const service = TraceListService.create({
        repository: emptyRepository(),
        evaluations: createApiFixture<EvaluationApi>({}),
        topicService: createApiFixture<TopicApi>({ getNamesByIds: async () => new Map() }),
        facets: CLICKHOUSE_FACET_CATALOG,
        discoverUpdates: updates,
      });

      const first = await service.getDiscover({
        tenantId: TENANT,
        timeRange: { from: 1_700_000_000_000, to: 1_700_086_400_000 },
      });

      expect(first.pending).toBe(true);
      await vi.waitFor(() => expect(updates.published).toHaveLength(1));
      const [published] = updates.published;
      expect(published?.tenantId).toBe(TENANT);
      expect(published?.eventType).toBe("discover_updated");
      expect(JSON.parse(published?.event ?? "")).toEqual({
        event: "discover_updated",
        tenantId: TENANT,
        timestamp: expect.any(Number),
      });
    });
  });
});
