/**
 * GovernanceKpisSyncReactor — unit tests with a mocked CH repository.
 *
 * Sergey commit b54696d95 (step 3b-ii) shipped the reactor that
 * folds governance-origin trace fold-completions into per-trace
 * contribution rows in the governance_kpis ClickHouse table.
 *
 * This test exercises the reactor's decision logic with a stubbed
 * repository — no testcontainers needed. Coverage:
 *
 *   - Skips traces with no `langwatch.origin.kind` attribute (not
 *     governance traffic).
 *   - Skips traces with `langwatch.origin.kind` !== "ingestion_source".
 *   - Warns + skips traces with missing `langwatch.ingestion_source.id`.
 *   - Skips traces with occurredAt <= 0 (initial fold sentinel).
 *   - Inserts a contribution row with all fields correctly populated
 *     when origin attrs are present.
 *   - HourBucket is floor-of-hour from foldState.occurredAt.
 *   - sourceType defaults to "unknown" if attribute missing.
 *
 * Spec contracts:
 *   - specs/ai-gateway/governance/folds.feature
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { GovernanceKpisClickHouseRepository } from "~/server/governance/governanceKpis.clickhouse.repository";
import type { ReactorContext } from "../../../../reactors/reactor.types";
import type { TraceProcessingEvent } from "../../schemas/events";
import {
  createGovernanceKpisSyncReactor,
  type GovernanceKpisSyncReactorDeps,
} from "../governanceKpisSync.reactor";

vi.mock("~/utils/logger/server", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock("~/utils/posthogErrorCapture", () => ({
  captureException: vi.fn(),
}));

const FIXED_OCCURRED_AT_MS = 1_700_000_000_000; // 2023-11-14T22:13:20Z
const EXPECTED_HOUR_BUCKET_MS = 1_700_000_000_000 - (1_700_000_000_000 % 3_600_000);

function createFoldState(
  attributes: Record<string, string> = {},
  overrides: Partial<TraceSummaryData> = {},
): TraceSummaryData {
  return {
    traceId: "trace-1",
    spanCount: 1,
    totalDurationMs: 250,
    computedIOSchemaVersion: "2025-12-18",
    computedInput: "hi",
    computedOutput: "bye",
    timeToFirstTokenMs: null,
    timeToLastTokenMs: null,
    tokensPerSecond: null,
    containsErrorStatus: false,
    containsOKStatus: true,
    errorMessage: null,
    models: ["gpt-5-mini"],
    totalCost: 0.0042,
    tokensEstimated: false,
    totalPromptTokenCount: 120,
    totalCompletionTokenCount: 42,
    outputFromRootSpan: false,
    outputSpanEndTimeMs: 0,
    blockedByGuardrail: false,
    topicId: null,
    subTopicId: null,
    annotationIds: [],
    lastEventOccurredAt: 0,
    occurredAt: FIXED_OCCURRED_AT_MS,
    createdAt: FIXED_OCCURRED_AT_MS,
    updatedAt: FIXED_OCCURRED_AT_MS,
    attributes,
    ...overrides,
  } as TraceSummaryData;
}

const event: TraceProcessingEvent = {
  id: "event-1",
  aggregateId: "trace-1",
  aggregateType: "trace",
  tenantId: "gov-project-1",
  createdAt: Date.now(),
  occurredAt: Date.now(),
  type: "lw.obs.trace.span_received",
  version: 1,
  data: {
    span: {} as any,
    resource: null,
    instrumentationScope: null,
    piiRedactionLevel: "STRICT",
  },
  metadata: { spanId: "span-1", traceId: "trace-1" },
} as unknown as TraceProcessingEvent;

function mockDeps(): {
  deps: GovernanceKpisSyncReactorDeps;
  insertContribution: ReturnType<typeof vi.fn>;
} {
  const insertContribution = vi.fn().mockResolvedValue(undefined);
  return {
    deps: {
      governanceKpisRepository: {
        insertContribution,
      } as unknown as GovernanceKpisClickHouseRepository,
    },
    insertContribution,
  };
}

function ctx(foldState: TraceSummaryData): ReactorContext<TraceSummaryData> {
  return {
    tenantId: "gov-project-1",
    aggregateId: "trace-1",
    foldState,
  };
}

describe("governanceKpisSync reactor", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("when the trace has no governance origin attributes", () => {
    it("skips silently — application traces never reach the fold", async () => {
      const { deps, insertContribution } = mockDeps();
      const reactor = createGovernanceKpisSyncReactor(deps);
      const state = createFoldState({});

      await reactor.handle(event, ctx(state));

      expect(insertContribution).not.toHaveBeenCalled();
    });
  });

  describe("when langwatch.origin.kind is not 'ingestion_source'", () => {
    it("skips — origin.kind is reserved for governance ingest only", async () => {
      const { deps, insertContribution } = mockDeps();
      const reactor = createGovernanceKpisSyncReactor(deps);
      const state = createFoldState({
        "langwatch.origin.kind": "personal_workspace",
      });

      await reactor.handle(event, ctx(state));

      expect(insertContribution).not.toHaveBeenCalled();
    });
  });

  describe("when origin.kind is set but ingestion_source.id is missing", () => {
    it("warns + skips — defensive against malformed governance traffic", async () => {
      const { deps, insertContribution } = mockDeps();
      const reactor = createGovernanceKpisSyncReactor(deps);
      const state = createFoldState({
        "langwatch.origin.kind": "ingestion_source",
      });

      await reactor.handle(event, ctx(state));

      expect(insertContribution).not.toHaveBeenCalled();
    });
  });

  describe("when occurredAt is the initial sentinel (0)", () => {
    it("skips — fold has not yet observed any spans", async () => {
      const { deps, insertContribution } = mockDeps();
      const reactor = createGovernanceKpisSyncReactor(deps);
      const state = createFoldState(
        {
          "langwatch.origin.kind": "ingestion_source",
          "langwatch.ingestion_source.id": "is-1",
          "langwatch.ingestion_source.source_type": "otel_generic",
        },
        { occurredAt: 0 },
      );

      await reactor.handle(event, ctx(state));

      expect(insertContribution).not.toHaveBeenCalled();
    });
  });

  describe("when origin attributes are fully present", () => {
    it("inserts a contribution row with all fields populated", async () => {
      const { deps, insertContribution } = mockDeps();
      const reactor = createGovernanceKpisSyncReactor(deps);
      const state = createFoldState({
        "langwatch.origin.kind": "ingestion_source",
        "langwatch.ingestion_source.id": "is-1",
        "langwatch.ingestion_source.source_type": "claude_cowork",
      });

      await reactor.handle(event, ctx(state));

      expect(insertContribution).toHaveBeenCalledTimes(1);
      const [row] = insertContribution.mock.calls[0]!;
      expect(row).toEqual({
        tenantId: "gov-project-1",
        sourceId: "is-1",
        sourceType: "claude_cowork",
        hourBucket: new Date(EXPECTED_HOUR_BUCKET_MS),
        traceId: "trace-1",
        spendUsd: 0.0042,
        promptTokens: 120,
        completionTokens: 42,
        lastEventOccurredAt: new Date(FIXED_OCCURRED_AT_MS),
      });
    });

    it("defaults sourceType to 'unknown' if attribute missing", async () => {
      const { deps, insertContribution } = mockDeps();
      const reactor = createGovernanceKpisSyncReactor(deps);
      const state = createFoldState({
        "langwatch.origin.kind": "ingestion_source",
        "langwatch.ingestion_source.id": "is-2",
      });

      await reactor.handle(event, ctx(state));

      expect(insertContribution).toHaveBeenCalledTimes(1);
      const [row] = insertContribution.mock.calls[0]!;
      expect(row.sourceType).toBe("unknown");
    });

    it("computes hour bucket as floor-of-hour from occurredAt", async () => {
      const { deps, insertContribution } = mockDeps();
      const reactor = createGovernanceKpisSyncReactor(deps);
      // 14:35:42 UTC of an arbitrary day — should floor to 14:00:00.
      const occurredAtMs = Date.UTC(2026, 3, 28, 14, 35, 42, 123);
      const expectedHourBucketMs = Date.UTC(2026, 3, 28, 14, 0, 0, 0);
      const state = createFoldState(
        {
          "langwatch.origin.kind": "ingestion_source",
          "langwatch.ingestion_source.id": "is-3",
          "langwatch.ingestion_source.source_type": "otel_generic",
        },
        { occurredAt: occurredAtMs },
      );

      await reactor.handle(event, ctx(state));

      const [row] = insertContribution.mock.calls[0]!;
      expect(row.hourBucket.getTime()).toBe(expectedHourBucketMs);
    });

    it("propagates zero for spend / tokens when fold state has nulls", async () => {
      const { deps, insertContribution } = mockDeps();
      const reactor = createGovernanceKpisSyncReactor(deps);
      const state = createFoldState(
        {
          "langwatch.origin.kind": "ingestion_source",
          "langwatch.ingestion_source.id": "is-4",
          "langwatch.ingestion_source.source_type": "workato",
        },
        {
          totalCost: null as any,
          totalPromptTokenCount: null,
          totalCompletionTokenCount: null,
        },
      );

      await reactor.handle(event, ctx(state));

      const [row] = insertContribution.mock.calls[0]!;
      expect(row.spendUsd).toBe(0);
      expect(row.promptTokens).toBe(0);
      expect(row.completionTokens).toBe(0);
    });
  });

  describe("when the repository throws", () => {
    it("captures the exception without rethrowing — reactor failures must not block the trace pipeline", async () => {
      const insertContribution = vi
        .fn()
        .mockRejectedValue(new Error("CH connection failed"));
      const deps: GovernanceKpisSyncReactorDeps = {
        governanceKpisRepository: {
          insertContribution,
        } as unknown as GovernanceKpisClickHouseRepository,
      };
      const reactor = createGovernanceKpisSyncReactor(deps);
      const state = createFoldState({
        "langwatch.origin.kind": "ingestion_source",
        "langwatch.ingestion_source.id": "is-5",
        "langwatch.ingestion_source.source_type": "otel_generic",
      });

      await expect(reactor.handle(event, ctx(state))).resolves.toBeUndefined();
      expect(insertContribution).toHaveBeenCalledTimes(1);
    });
  });

  describe("dedup contract", () => {
    it("declares a per-(tenant, trace) job-id for BullMQ debounce", () => {
      const { deps } = mockDeps();
      const reactor = createGovernanceKpisSyncReactor(deps);
      expect(reactor.options?.makeJobId).toBeDefined();
      const jobId = reactor.options!.makeJobId!({
        event: { tenantId: "t-1", aggregateId: "trace-x" },
      } as any);
      expect(jobId).toBe("governance-kpis-sync-t-1-trace-x");
      expect(reactor.options?.ttl).toBeGreaterThan(0);
    });
  });
});
