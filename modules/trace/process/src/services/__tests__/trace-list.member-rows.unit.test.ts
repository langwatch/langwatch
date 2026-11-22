/**
 * @vitest-environment node
 * @unit
 * ADR-177 block F: an aggregate's list rows name the member that owns them and carry that member's
 * evaluations alone; two members may hold the same trace id.
 */
import { describe, expect, it, vi } from "vitest";

import { aggregateProof } from "../../__tests__/support/authorization-proofs.fixture.ts";
import { CLICKHOUSE_FACET_CATALOG } from "../../features/facet/repositories/clickhouse/clickhouse.trace-facet-registry.mapper.ts";
import { TraceListService } from "../../features/read/services/trace-list-read.service.ts";
import { listedRow } from "./support/trace-list-rows.support.ts";

const NOW = 1_700_000_000_000;

function evaluation({ tenantId, evaluatorId }: { tenantId: string; evaluatorId: string }) {
  return {
    tenantId,
    traceId: "twin",
    evaluationId: `${tenantId}-${evaluatorId}`,
    evaluatorId,
    evaluatorType: "langevals/basic",
    evaluatorName: evaluatorId,
    isGuardrail: false,
    status: "processed" as const,
    score: 1,
    passed: true,
    label: null,
  };
}

describe("TraceListService.getList on an aggregate", () => {
  describe("given two members holding the same trace id, each scored by its own monitor", () => {
    it("names each row's member and keeps each member's evaluation on its own row", async () => {
      const findSummariesByTraceIds = vi
        .fn()
        .mockResolvedValue([
          evaluation({ tenantId: "member-a", evaluatorId: "monitor-a" }),
          evaluation({ tenantId: "member-b", evaluatorId: "monitor-b" }),
        ]);
      const service = TraceListService.create({
        discoverUpdates: { publishProjectEvent: async () => {} },
        facets: CLICKHOUSE_FACET_CATALOG,
        repository: {
          listAll: vi.fn().mockResolvedValue({
            rows: [
              listedRow({ tenantId: "member-a", traceId: "twin", occurredAt: NOW - 5 }),
              listedRow({ tenantId: "member-b", traceId: "twin", occurredAt: NOW - 5 }),
            ],
            totalHits: 2,
          }),
        } as never,
        evaluationRuns: { findSummariesByTraceIds },
        topicNames: { findNamesByIds: vi.fn().mockResolvedValue(new Map()) },
      });

      const page = await service.getList({
        authorization: aggregateProof({
          projectId: "aggregate",
          members: [
            { projectId: "member-a", from: 0 },
            { projectId: "member-b", from: 0 },
          ],
          now: NOW,
        }),
        timeRange: { from: NOW - 86_400_000, to: NOW },
        sort: { columnId: "timestamp", direction: "desc" },
        pageSize: 10,
      });

      expect(
        page.items.map((item) => ({
          projectId: item.projectId,
          evaluators: item.evaluations.map((e) => e.evaluatorId),
        })),
      ).toEqual([
        { projectId: "member-a", evaluators: ["monitor-a"] },
        { projectId: "member-b", evaluators: ["monitor-b"] },
      ]);
      // The repeated id is read once.
      expect(findSummariesByTraceIds.mock.calls[0]?.[0].traceIds).toEqual(["twin"]);
    });
  });
});
