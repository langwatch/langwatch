/**
 * @vitest-environment node
 * @unit
 * The keyset cursor names a row by tenant and trace id: two aggregate members may hold the same
 * trace id (ADR-177). A cursor minted before the tenant was carried reads as the proof's project.
 */
import { describe, expect, it, vi } from "vitest";

import { aggregateProof, ownProof } from "../../__tests__/support/authorization-proofs.fixture.ts";
import { CLICKHOUSE_FACET_CATALOG } from "../../features/facet/repositories/clickhouse/clickhouse.trace-facet-registry.mapper.ts";
import { TraceListService } from "../../features/read/services/trace-list-read.service.ts";
import { MemoryTraceEvaluationRunsRepository } from "../../repositories/memory/memory.trace-evaluation-runs.repository.ts";
import { listedRow } from "./support/trace-list-rows.support.ts";

function serviceWithRepository(listAll: ReturnType<typeof vi.fn>) {
  return TraceListService.create({
    discoverUpdates: { publishProjectEvent: async () => {} },
    facets: CLICKHOUSE_FACET_CATALOG,
    repository: { listAll } as never,
    evaluationRuns: MemoryTraceEvaluationRunsRepository.create(),
    topicNames: { findNamesByIds: vi.fn().mockResolvedValue(new Map()) },
  });
}

const NOW = 1_700_000_000_000;

const listParams = {
  timeRange: { from: NOW - 86_400_000, to: NOW },
  sort: { columnId: "timestamp", direction: "desc" as const },
  pageSize: 1,
};

describe("TraceListService.getList keyset cursor", () => {
  describe("given an aggregate page whose last row belongs to a member", () => {
    it("mints the next cursor with that member's tenant alongside the trace id", async () => {
      const listAll = vi.fn().mockResolvedValue({
        rows: [
          listedRow({ tenantId: "member-a", traceId: "twin", occurredAt: NOW - 5 }),
          listedRow({ tenantId: "member-b", traceId: "twin", occurredAt: NOW - 5 }),
        ],
        totalHits: 2,
      });

      const page = await serviceWithRepository(listAll).getList({
        ...listParams,
        authorization: aggregateProof({
          projectId: "aggregate",
          members: [
            { projectId: "member-a", from: 0 },
            { projectId: "member-b", from: 0 },
          ],
          now: NOW,
        }),
      });

      expect(page.nextCursor).toEqual({
        sortValue: NOW - 5,
        tenantId: "member-a",
        traceId: "twin",
      });
    });
  });

  describe("given a cursor that carries its tenant", () => {
    it("hands it to the repository unchanged", async () => {
      const listAll = vi.fn().mockResolvedValue({ rows: [], totalHits: 0 });

      await serviceWithRepository(listAll).getList({
        ...listParams,
        authorization: ownProof({ projectId: "tenant-1", now: NOW }),
        cursor: { sortValue: NOW - 5, tenantId: "member-a", traceId: "twin" },
      });

      expect(listAll).toHaveBeenCalledWith(
        expect.objectContaining({
          cursor: { sortValue: NOW - 5, tenantId: "member-a", traceId: "twin" },
        }),
      );
    });
  });

  describe("given a cursor minted before the tenant was carried", () => {
    it("reads it as the project the proof was minted for", async () => {
      const listAll = vi.fn().mockResolvedValue({ rows: [], totalHits: 0 });

      await serviceWithRepository(listAll).getList({
        ...listParams,
        authorization: ownProof({ projectId: "tenant-1", now: NOW }),
        cursor: { sortValue: NOW - 5, traceId: "trace-a" },
      });

      expect(listAll).toHaveBeenCalledWith(
        expect.objectContaining({
          cursor: { sortValue: NOW - 5, tenantId: "tenant-1", traceId: "trace-a" },
        }),
      );
    });
  });
});
