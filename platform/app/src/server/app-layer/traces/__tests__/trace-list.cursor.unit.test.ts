/**
 * @vitest-environment node
 * @unit
 *
 * The keyset cursor of the flat trace list names a row by tenant and trace
 * id: on an aggregate project two members may hold the same trace id, so the
 * id alone no longer picks a row (ADR-144 v4.1). A cursor minted before the
 * tenant was carried still decodes, read as the project the proof was minted
 * for, which is exactly right on a plain project.
 */
import { describe, expect, it, vi } from "vitest";

import { aggregateProof, ownProof } from "~/test-utils/authorizationProofs";
import type { TraceListRow } from "../repositories/trace-list.repository";
import { TraceListService } from "../trace-list.service";

function serviceWithRepository(findAll: ReturnType<typeof vi.fn>) {
  return new TraceListService(
    { findAll } as never,
    { findSummariesByTraceIds: vi.fn().mockResolvedValue({}) } as never,
    { getNamesByIds: vi.fn().mockResolvedValue(new Map()) } as never,
  );
}

/** The fields the list mapper and the cursor read; the rest is the row's shape only. */
function row({
  tenantId,
  traceId,
  occurredAt,
}: {
  tenantId: string;
  traceId: string;
  occurredAt: number;
}): TraceListRow {
  const partial: Partial<TraceListRow> = {
    tenantId,
    traceId,
    spanCount: 1,
    totalDurationMs: 10,
    computedInput: null,
    computedOutput: null,
    timeToFirstTokenMs: null,
    containsErrorStatus: false,
    errorMessage: null,
    models: [],
    totalCost: null,
    nonBilledCost: null,
    tokensEstimated: false,
    totalPromptTokenCount: null,
    totalCompletionTokenCount: null,
    rootSpanType: null,
    attributes: {},
    traceName: "",
    occurredAt,
    createdAt: occurredAt,
    updatedAt: occurredAt,
    LastEventOccurredAt: occurredAt,
  };
  return partial as TraceListRow;
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
      const findAll = vi.fn().mockResolvedValue({
        rows: [
          row({ tenantId: "member-a", traceId: "twin", occurredAt: NOW - 5 }),
          row({ tenantId: "member-b", traceId: "twin", occurredAt: NOW - 5 }),
        ],
        totalHits: 2,
      });
      const service = serviceWithRepository(findAll);

      const page = await service.getList({
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
      const findAll = vi.fn().mockResolvedValue({ rows: [], totalHits: 0 });
      const service = serviceWithRepository(findAll);

      await service.getList({
        ...listParams,
        authorization: ownProof({ projectId: "tenant-1", now: NOW }),
        cursor: { sortValue: NOW - 5, tenantId: "member-a", traceId: "twin" },
      });

      expect(findAll).toHaveBeenCalledWith(
        expect.objectContaining({
          cursor: { sortValue: NOW - 5, tenantId: "member-a", traceId: "twin" },
        }),
      );
    });
  });

  describe("given a cursor minted before the tenant was carried", () => {
    it("reads it as the project the proof was minted for", async () => {
      const findAll = vi.fn().mockResolvedValue({ rows: [], totalHits: 0 });
      const service = serviceWithRepository(findAll);

      await service.getList({
        ...listParams,
        authorization: ownProof({ projectId: "tenant-1", now: NOW }),
        cursor: { sortValue: NOW - 5, traceId: "trace-a" },
      });

      expect(findAll).toHaveBeenCalledWith(
        expect.objectContaining({
          cursor: {
            sortValue: NOW - 5,
            tenantId: "tenant-1",
            traceId: "trace-a",
          },
        }),
      );
    });
  });
});
