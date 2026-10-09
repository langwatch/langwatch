/**
 * @vitest-environment node
 * The trace list read under an aggregate's proof: pages continue on the (tenant, trace id) pair,
 * shared ids are asked for once, and topic labels come from the member that owns the topic.
 */
import { aggregateProof } from "@langwatch/authorization/testing";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { TraceListRead, TraceListSummary } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import { CLICKHOUSE_FACET_CATALOG } from "../../../facet/repositories/clickhouse/clickhouse.trace-facet-registry.mapper.ts";
import { TraceListService } from "../trace-list-read.service.ts";

const NOW = 1_700_086_400_000;
const timeRange = { from: 1_700_000_000_000, to: NOW };
const authorization = aggregateProof({
  projectId: "aggregate",
  members: [{ projectId: "member-a", from: 0 }],
  now: NOW,
});

function row({ tenantId, traceId }: { tenantId: string; traceId: string }): TraceListSummary {
  return {
    tenantId,
    traceId,
    spanCount: 1,
    totalDurationMs: 10,
    computedIOSchemaVersion: "2025-12-18",
    computedInput: null,
    computedOutput: null,
    timeToFirstTokenMs: null,
    timeToLastTokenMs: null,
    tokensPerSecond: null,
    containsErrorStatus: false,
    containsOKStatus: true,
    errorMessage: null,
    models: [],
    totalCost: null,
    nonBilledCost: null,
    tokensEstimated: false,
    totalPromptTokenCount: null,
    totalCompletionTokenCount: null,
    outputFromRootSpan: false,
    outputSpanEndTimeMs: 0,
    blockedByGuardrail: false,
    rootSpanType: null,
    containsAi: false,
    containsPrompt: false,
    selectedPromptId: null,
    selectedPromptSpanId: null,
    selectedPromptStartTimeMs: null,
    lastUsedPromptId: null,
    lastUsedPromptVersionNumber: null,
    lastUsedPromptVersionId: null,
    lastUsedPromptSpanId: null,
    lastUsedPromptStartTimeMs: null,
    topicId: null,
    subTopicId: null,
    annotationIds: [],
    attributes: {},
    traceName: "",
    occurredAt: 1_700_000_000_500,
    createdAt: 1_700_000_000_500,
    updatedAt: 1_700_000_000_500,
    LastEventOccurredAt: 1_700_000_000_500,
  };
}

type ListCollaborators = Parameters<typeof TraceListService.create>[0];
type SummariesRead = ListCollaborators["evaluationRuns"]["findSummariesByTraceIds"];
type NamesRead = ListCollaborators["topicNames"]["findNamesByIds"];

function serviceOver({
  repository,
  findSummariesByTraceIds = vi.fn<SummariesRead>().mockResolvedValue({}),
  findNamesByIds = vi.fn<NamesRead>().mockResolvedValue(new Map()),
}: {
  repository: TraceListRead;
  findSummariesByTraceIds?: SummariesRead;
  findNamesByIds?: NamesRead;
}) {
  return TraceListService.create({
    repository,
    evaluationRuns: { findSummariesByTraceIds },
    topicNames: { findNamesByIds },
    facets: CLICKHOUSE_FACET_CATALOG,
    discoverUpdates: { publishProjectEvent: async () => {} },
  });
}

describe("the trace list under an aggregate's proof", () => {
  describe("given a page whose last row belongs to a shared member", () => {
    it("continues from that member's row, its tenant on the cursor", async () => {
      const listAll = vi.fn().mockResolvedValue({
        rows: [
          row({ tenantId: "aggregate", traceId: "shared" }),
          row({ tenantId: "member-a", traceId: "shared" }),
          row({ tenantId: "member-a", traceId: "sentinel" }),
        ],
        totalHits: 3,
      });
      const service = serviceOver({ repository: createApiFixture<TraceListRead>({ listAll }) });

      const page = await service.getList({
        authorization,
        timeRange,
        sort: { columnId: "timestamp", direction: "desc" },
        pageSize: 2,
      });

      expect(listAll).toHaveBeenCalledWith(expect.objectContaining({ authorization }));
      expect(page.nextCursor).toEqual({
        sortValue: expect.any(Number),
        tenantId: "member-a",
        traceId: "shared",
      });
    });
  });

  describe("given two members that hold the same trace id", () => {
    it("asks for that trace's evaluations once, under the proof", async () => {
      const findSummariesByTraceIds = vi.fn<SummariesRead>().mockResolvedValue({});
      const listAll = vi.fn().mockResolvedValue({
        rows: [
          row({ tenantId: "aggregate", traceId: "shared" }),
          row({ tenantId: "member-a", traceId: "shared" }),
        ],
        totalHits: 2,
      });
      const service = serviceOver({
        repository: createApiFixture<TraceListRead>({ listAll }),
        findSummariesByTraceIds,
      });

      await service.getList({
        authorization,
        timeRange,
        sort: { columnId: "timestamp", direction: "desc" },
        pageSize: 10,
      });

      expect(findSummariesByTraceIds).toHaveBeenCalledWith({
        authorization,
        traceIds: ["shared"],
        since: timeRange.from,
      });
    });
  });

  describe("given a topic clustered by a shared member", () => {
    it("labels it with the member's topic name", async () => {
      const findNamesByIds = vi.fn(async ({ projectId }: { projectId: string }) =>
        projectId === "member-a" ? new Map([["topic-m", "Billing"]]) : new Map(),
      );
      const repository = createApiFixture<TraceListRead>({
        findCategoricalFacet: async () => ({
          values: [{ value: "topic-m", count: 3 }],
          totalDistinct: 1,
        }),
      });
      const service = serviceOver({ repository, findNamesByIds });

      const result = await service.getFacetValues({
        authorization,
        timeRange,
        facetKey: "topic",
        limit: 10,
        offset: 0,
      });

      expect(result.values).toEqual([{ value: "topic-m", count: 3, label: "Billing" }]);
      expect(findNamesByIds.mock.calls.map(([input]) => input.projectId).toSorted()).toEqual([
        "aggregate",
        "member-a",
      ]);
    });
  });
});
