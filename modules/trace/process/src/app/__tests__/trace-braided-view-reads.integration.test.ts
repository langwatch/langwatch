/**
 * The header's totals, span tree, full spans, resources, timeline, badges and Braids page count of
 * a braided trace (ADR-201 §8): each audits first, and fails when the audit cannot be written.
 * Spec: modules/trace/specs/braided-spans.feature
 */
import type { AuthzApi } from "@langwatch/authz-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import {
  baseSpanSchema,
  type SpanResourceInfo,
  type SpanSummaryRow,
  type TraceSummaryData,
} from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import { braidedProof } from "../../__tests__/support/authorization-proofs.fixture.ts";
import { MemoryNullTraceBraidReadsRepository } from "../../features/braid/repositories/memory/memory.null-trace-braid-reads.repository.ts";
import { openProtections } from "../../repositories/clickhouse/__tests__/open-protections.ts";
import type { TraceViewerProtectionService } from "../../services/trace-viewer-protection.service.ts";
import type { TraceAppDependencies, TracesSpanReader } from "../trace.app.ts";
import { braidPlansOf, createTraceAppHarness } from "./support/trace-app.harness.ts";

const READER = "proj_orchestrator";
const OWNER = "proj_specialists";
const BRAID_ID = "braid_web";

/** The header's whole-trace summary, as the summary store returns it. */
function traceSummaryOf(): TraceSummaryData & { tenantId: string } {
  return {
    tenantId: READER,
    traceId: "trace-1",
    spanCount: 1,
    totalDurationMs: 10,
    computedIOSchemaVersion: "2025-12-18",
    computedInput: "the question",
    computedOutput: "the answer",
    timeToFirstTokenMs: null,
    timeToLastTokenMs: null,
    tokensPerSecond: null,
    containsErrorStatus: false,
    containsOKStatus: true,
    errorMessage: null,
    models: [],
    totalCost: 1.5,
    nonBilledCost: null,
    tokensEstimated: false,
    totalPromptTokenCount: 3,
    totalCompletionTokenCount: 4,
    outputFromRootSpan: true,
    outputSpanEndTimeMs: 10,
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
    traceName: "a trace",
    occurredAt: 1_000,
    createdAt: 1_000,
    updatedAt: 1_000,
    LastEventOccurredAt: 1_000,
  };
}

/** One project's spans in the trace, as the header's braided totals read them. */
function totalsOf(tenantId: string) {
  return {
    tenantId,
    spanCount: 1,
    startMs: 0,
    endMs: 1,
    inputTokens: 1,
    outputTokens: 1,
    explicitCost: 0,
    costInput: null,
  };
}

function spanOf(spanId: string, ownerProjectId?: string) {
  const span = baseSpanSchema.parse({
    span_id: spanId,
    trace_id: "trace-1",
    type: "span",
    timestamps: { started_at: 1_700_000_000_000, finished_at: 1_700_000_000_010 },
  });
  return ownerProjectId === undefined ? span : { ...span, ownerProjectId };
}

function summaryOf(spanId: string, ownerProjectId?: string): SpanSummaryRow {
  return {
    spanId,
    parentSpanId: null,
    spanName: "step",
    durationMs: 1,
    statusCode: null,
    spanType: "llm",
    toolName: null,
    requestId: null,
    querySource: null,
    toolUseId: null,
    model: null,
    cost: null,
    inputTokens: null,
    outputTokens: null,
    cacheReadTokens: null,
    cacheCreationTokens: null,
    startTimeMs: 0,
    updatedAtMs: 0,
    ...(ownerProjectId === undefined ? {} : { ownerProjectId }),
  };
}

function resourceOf(spanId: string, ownerProjectId?: string): SpanResourceInfo {
  return {
    spanId,
    parentSpanId: null,
    startTimeMs: 0,
    resourceAttributes: {},
    scopeName: "scope",
    scopeVersion: null,
    ...(ownerProjectId === undefined ? {} : { ownerProjectId }),
  };
}

function eventOf(spanId: string, ownerProjectId?: string) {
  return {
    spanId,
    timestamp: 0,
    name: "event",
    attributes: {},
    ...(ownerProjectId === undefined ? {} : { ownerProjectId }),
  };
}

function signalsOf(spanId: string, ownerProjectId?: string) {
  return { spanId, signals: [], ...(ownerProjectId === undefined ? {} : { ownerProjectId }) };
}

/** Each view's rows: the reader's span and, when braided, the owner's. */
function rowsOf<T>(make: (spanId: string, ownerProjectId?: string) => T, braided: boolean): T[] {
  return [make("reader-span"), make("owner-span", braided ? OWNER : undefined)];
}

function braidedTrace({ withOwnerSpans = true } = {}) {
  const recordBraidedSpansView = vi.fn<AuthzApi["recordBraidedSpansView"]>(async () => undefined);
  const app = createTraceAppHarness({
    protections: createApiFixture<TraceViewerProtectionService>(
      { resolve: async () => openProtections },
      "protections",
    ),
    braidPlans: braidPlansOf("ENTERPRISE"),
    braidDirectory: {
      authz: createApiFixture<AuthzApi>(
        {
          recordBraidedSpansView,
          hasPermission: async () => false,
          listBraids: async () => ({
            intoOtherProjects: [],
            fromOtherProjects: [
              {
                braidId: BRAID_ID,
                ownerProjectId: OWNER,
                readerProjectId: READER,
                where: 'attributes["orchestrator"] == "web"',
                fromMs: 0,
                expiresAtMs: null,
                createdByUserId: null,
                createdAtMs: 0,
              },
            ],
          }),
        },
        "braidAuthz",
      ),
      projects: createApiFixture<ProjectApi>(
        { findSummaryById: async () => ({ name: "Specialists", slug: "specialists" }) },
        "braidProjects",
      ),
    },
    traces: {
      summary: createApiFixture<TraceAppDependencies["traces"]["summary"]>(
        {
          getTraceAuthorization: async ({ authorization }) => authorization,
          getByTraceId: async () => traceSummaryOf(),
        },
        "summary",
      ),
      braidReads: Object.assign(MemoryNullTraceBraidReadsRepository.create(), {
        sumSpansInTrace: async () =>
          withOwnerSpans ? [totalsOf(READER), totalsOf(OWNER)] : [totalsOf(READER)],
        countReaderBraidActivity: async () => new Map([[BRAID_ID, withOwnerSpans ? 3 : 0]]),
      }),
      spans: createApiFixture<TracesSpanReader>(
        {
          getSpanSummaryByTraceId: async () => rowsOf(summaryOf, withOwnerSpans),
          getSpansByTraceId: async () => rowsOf(spanOf, withOwnerSpans),
          getSpanResourcesByTraceId: async () => rowsOf(resourceOf, withOwnerSpans),
          getTraceEventsByTraceId: async () => rowsOf(eventOf, withOwnerSpans),
          getLangwatchSignalsByTraceId: async () => rowsOf(signalsOf, withOwnerSpans),
        },
        "spans",
      ),
    },
  });
  const authorization = braidedProof({ projectId: READER, braids: [{ owner: OWNER }] });
  const viewer = { projectId: READER, authorization, traceId: "trace-1", viewerUserId: "sam" };
  const reads = {
    header: () => app.readTraceHeaderForViewer(viewer),
    activity: () =>
      app.readBraidActivity({ projectId: READER, authorization, braidIds: [BRAID_ID] }),
    spanTree: () => app.readSpanTreeForViewer(viewer),
    spansFull: () => app.readSpansFullForViewer(viewer),
    resources: () => app.readSpanResourcesForViewer(viewer),
    traceEvents: () => app.readTraceEventsForViewer(viewer),
    // What the `spanLangwatchSignals` procedure calls, on the proof the trace honoured.
    spanLangwatchSignals: async () =>
      app.readLangwatchSignals({
        authorization: await app.authorizationForTrace({ authorization, traceId: "trace-1" }),
        traceId: "trace-1",
        reads: "spans",
      }),
  };
  return { reads, recordBraidedSpansView, authorization };
}

const READS = [
  "header",
  "spanTree",
  "spansFull",
  "resources",
  "traceEvents",
  "spanLangwatchSignals",
] as const;

describe("the trace views of a braided trace", () => {
  describe.each(READS)("when %s returns an owner's span", (read) => {
    /** @scenario "Every view of a braided trace is audited, or refused" */
    it("records one braided spans viewed entry, naming the reader and the owner", async () => {
      const { reads, recordBraidedSpansView, authorization } = braidedTrace();

      await reads[read]();

      expect(recordBraidedSpansView).toHaveBeenCalledTimes(1);
      expect(recordBraidedSpansView).toHaveBeenCalledWith({
        actor: authorization.actor,
        readerProjectId: READER,
        ownerProjectIds: [OWNER],
      });
    });

    /** @scenario "Every view of a braided trace is audited, or refused" */
    it("fails rather than return the owner's span when the entry cannot be written", async () => {
      const { reads, recordBraidedSpansView } = braidedTrace();
      recordBraidedSpansView.mockRejectedValueOnce(new Error("audit store unreachable"));

      await expect(reads[read]()).rejects.toThrow("audit store unreachable");
    });
  });

  describe("when the reader's Braids page counts a braid's spans", () => {
    /** @scenario "The reader's braid activity counts are audited, or refused" */
    it("records the braided spans viewed entry, naming the owner, before it returns", async () => {
      const { reads, recordBraidedSpansView, authorization } = braidedTrace();

      expect((await reads.activity()).activity).toEqual([{ braidId: BRAID_ID, spanCount: 3 }]);
      expect(recordBraidedSpansView).toHaveBeenCalledWith({
        actor: authorization.actor,
        readerProjectId: READER,
        ownerProjectIds: [OWNER],
      });
    });

    /** @scenario "The reader's braid activity counts are audited, or refused" */
    it("fails rather than return the count when the entry cannot be written", async () => {
      const { reads, recordBraidedSpansView } = braidedTrace();
      recordBraidedSpansView.mockRejectedValueOnce(new Error("audit store unreachable"));

      await expect(reads.activity()).rejects.toThrow("audit store unreachable");
    });
  });

  describe.each(READS)("when %s returns only the reader's own spans", (read) => {
    it("records nothing", async () => {
      const { reads, recordBraidedSpansView } = braidedTrace({ withOwnerSpans: false });

      await reads[read]();

      expect(recordBraidedSpansView).not.toHaveBeenCalled();
    });
  });
});
