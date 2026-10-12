/**
 * @vitest-environment node
 * @unit
 *
 * ADR-144 block F: an aggregate's list rows are first-class. Each row names
 * the member project that owns it and carries that member's evaluations
 * alone: two members may hold the same trace id, and the id alone would hand
 * one member's evaluation to the other's row.
 */
import { describe, expect, it, vi } from "vitest";

import type { TenantEvalSummary } from "~/server/app-layer/evaluations/repositories/evaluation-run.repository";
import { aggregateProof } from "~/test-utils/authorizationProofs";
import type { TraceListRow } from "../repositories/trace-list.repository";
import { TraceListService } from "../trace-list.service";

const NOW = 1_700_000_000_000;

function row(tenantId: string, traceId: string): TraceListRow {
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
    occurredAt: NOW - 5,
    createdAt: NOW - 5,
    updatedAt: NOW - 5,
    LastEventOccurredAt: NOW - 5,
  };
  return partial as TraceListRow;
}

function evaluation(tenantId: string, traceId: string, evaluatorId: string) {
  return {
    tenantId,
    traceId,
    evaluationId: `${tenantId}-${evaluatorId}`,
    evaluatorId,
    evaluatorType: "langevals/basic",
    evaluatorName: evaluatorId,
    isGuardrail: false,
    status: "processed",
    score: 1,
    passed: true,
    label: null,
  } satisfies TenantEvalSummary;
}

describe("TraceListService.getList on an aggregate", () => {
  describe("given two members holding the same trace id, each scored by its own monitor", () => {
    it("names each row's member and keeps each member's evaluation on its own row", async () => {
      const findSummariesByTraceIds = vi
        .fn()
        .mockResolvedValue([
          evaluation("member-a", "twin", "monitor-a"),
          evaluation("member-b", "twin", "monitor-b"),
        ]);
      const service = new TraceListService(
        {
          findAll: vi.fn().mockResolvedValue({
            rows: [row("member-a", "twin"), row("member-b", "twin")],
            totalHits: 2,
          }),
        } as never,
        { findSummariesByTraceIds } as never,
        { getNamesByIds: vi.fn().mockResolvedValue(new Map()) } as never,
      );

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
      expect(findSummariesByTraceIds.mock.calls[0]?.[0].traceIds).toEqual([
        "twin",
      ]);
    });
  });
});
