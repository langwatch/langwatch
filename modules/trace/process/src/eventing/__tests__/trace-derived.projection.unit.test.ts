/**
 * The analytics fold writes the managed prompt version its trace last used as a column of its row:
 * the latest prompt span by start time wins, the larger SpanId breaking a tie (goose 00133).
 */
import { createTenantId, type ProjectionStoreContext } from "@langwatch/eventing";
import type { NormalizedSpan } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { ownProofAuthorizer } from "../../__tests__/support/authorization-proofs.fixture.ts";
import { TraceCanonicalisationService } from "../../features/derivation/services/trace-canonicalisation.service.ts";
import { TraceAnalyticsProjectionRepository } from "../../repositories/trace-analytics-projection.repository.ts";
import {
  TRACE_ANALYTICS_PROJECTION_VERSION_LATEST,
  TRACE_ANALYTICS_PROJECTION_VERSION_PRE_PROMPT_VERSION,
  TraceAnalyticsFoldProjection,
  type TraceAnalyticsData,
  type TraceAnalyticsRow,
} from "../trace-derived.projection.ts";
import { TraceAnalyticsStore } from "../trace-derived.store.ts";
import { memoryEvaluationAnalytics } from "./trace-evaluation-analytics.fixtures.ts";
import { createTestRuntime, createTestSpan } from "./trace-summary-test.fixtures.ts";

const TENANT = "tenant-prompt-version";
const TRACE_ID = "trace-1";

const runtime = createTestRuntime();
const projection = TraceAnalyticsFoldProjection.create({
  store: { store: async () => {}, get: async () => ({ kind: "empty" as const }) },
  traceCanonicalisation: TraceCanonicalisationService.create(),
  runtime,
});

/** A span that used a managed prompt at the given version, as the SDK reports it. */
function promptSpan({
  spanId,
  startTimeUnixMs,
  versionId,
}: {
  spanId: string;
  startTimeUnixMs: number;
  versionId: string;
}): NormalizedSpan {
  return createTestSpan({
    spanId,
    startTimeUnixMs,
    spanAttributes: {
      "langwatch.prompt.id": "support-bot",
      "langwatch.prompt.version.id": versionId,
    },
  });
}

function foldSpans(spans: readonly NormalizedSpan[]): TraceAnalyticsData {
  return spans.reduce(
    (state, span) => TraceAnalyticsFoldProjection.applySpanToAnalytics({ state, span, runtime }),
    { ...projection.init(), traceId: TRACE_ID },
  );
}

function rowOf(state: TraceAnalyticsData): TraceAnalyticsRow {
  return TraceAnalyticsFoldProjection.projectAnalyticsStateToRow({
    state,
    tenantId: TENANT,
    version: TRACE_ANALYTICS_PROJECTION_VERSION_LATEST,
  });
}

function versionWritten(spans: readonly NormalizedSpan[]): string | undefined {
  return rowOf(foldSpans(spans)).lastUsedPromptVersionId;
}

/** A store whose port answers every read with one fixed row. */
function storeOver(row: TraceAnalyticsRow): TraceAnalyticsStore {
  const storage = new (class extends TraceAnalyticsProjectionRepository {
    async upsert(): Promise<void> {}
    async findByTraceId() {
      return { row, appliedEventIds: [] };
    }
  })();
  return TraceAnalyticsStore.create({
    storage,
    evaluationAnalytics: memoryEvaluationAnalytics(),
    defaultRetentionDays: () => 90,
    authorize: ownProofAuthorizer,
  });
}

describe("TraceAnalyticsFoldProjection managed prompt version", () => {
  describe("given a trace whose prompt spans used two versions", () => {
    const earlier = promptSpan({ spanId: "span-b", startTimeUnixMs: 1_000, versionId: "pv-old" });
    const later = promptSpan({ spanId: "span-a", startTimeUnixMs: 2_000, versionId: "pv-new" });

    it("writes the version of the span that started last, in arrival order", () => {
      expect(versionWritten([earlier, later])).toBe("pv-new");
    });

    it("writes the version of the span that started last when it arrives first", () => {
      expect(versionWritten([later, earlier])).toBe("pv-new");
    });
  });

  describe("given two prompt spans that started at the same instant", () => {
    const smaller = promptSpan({ spanId: "span-a", startTimeUnixMs: 1_000, versionId: "pv-a" });
    const larger = promptSpan({ spanId: "span-b", startTimeUnixMs: 1_000, versionId: "pv-b" });

    it("writes the version of the span with the larger SpanId, whichever arrives first", () => {
      expect(versionWritten([smaller, larger])).toBe("pv-b");
      expect(versionWritten([larger, smaller])).toBe("pv-b");
    });
  });

  describe("given a prompt span followed by a later span with no prompt", () => {
    it("keeps the prompt span's version", () => {
      const prompt = promptSpan({ spanId: "span-a", startTimeUnixMs: 1_000, versionId: "pv-1" });
      const plain = createTestSpan({ spanId: "span-b", startTimeUnixMs: 5_000 });

      expect(versionWritten([prompt, plain])).toBe("pv-1");
    });
  });

  describe("given a trace that used no managed prompt", () => {
    it("writes an empty string", () => {
      expect(versionWritten([createTestSpan({ spanId: "span-a" })])).toBe("");
    });
  });

  describe("given a row read back from the store", () => {
    it("keeps the version the row carries on its next write", () => {
      const folded = foldSpans([
        promptSpan({ spanId: "span-a", startTimeUnixMs: 1_000, versionId: "pv-1" }),
      ]);
      const resumed = TraceAnalyticsFoldProjection.traceAnalyticsStateFromRow(rowOf(folded));
      const next = TraceAnalyticsFoldProjection.applySpanToAnalytics({
        state: resumed,
        span: createTestSpan({ spanId: "span-b", startTimeUnixMs: 2_000 }),
        runtime,
      });

      expect(rowOf(next).lastUsedPromptVersionId).toBe("pv-1");
    });
  });

  describe("given the projection version", () => {
    it("stamps rows with a version newer than the one before the column", () => {
      expect(projection.version).toBe(TRACE_ANALYTICS_PROJECTION_VERSION_LATEST);
      expect(
        TRACE_ANALYTICS_PROJECTION_VERSION_LATEST >
          TRACE_ANALYTICS_PROJECTION_VERSION_PRE_PROMPT_VERSION,
      ).toBe(true);
    });

    it("still decodes a row stamped before the column, so live traces do not refold", async () => {
      const row: TraceAnalyticsRow = {
        ...rowOf(foldSpans([createTestSpan({ spanId: "span-a" })])),
        version: TRACE_ANALYTICS_PROJECTION_VERSION_PRE_PROMPT_VERSION,
        lastUsedPromptVersionId: "",
      };
      const context = {
        aggregateId: TRACE_ID,
        tenantId: createTenantId(TENANT),
      } as ProjectionStoreContext;

      const read = await storeOver(row).getWithApplied(TRACE_ID, context);

      expect(read.miss).toBeUndefined();
      expect(read.state).toMatchObject({ traceId: TRACE_ID, spanCount: 1 });
      expect(read.state?.lastUsedPromptVersionId).toBeUndefined();
    });
  });
});
