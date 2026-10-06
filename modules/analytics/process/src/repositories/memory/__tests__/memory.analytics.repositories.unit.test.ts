import type {
  AnalyticsEvaluationRow,
  AnalyticsTimeseriesInput,
} from "@langwatch/analytics-contract";
import { SecurityError } from "@langwatch/eventing";
import { nowInstant, Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { MemoryAnalyticsRepositories } from "../memory.analytics.repositories.ts";

const OCCURRED_AT_MS = 1_750_000_000_000;

function evaluationRow(overrides: Partial<AnalyticsEvaluationRow> = {}): AnalyticsEvaluationRow {
  return {
    tenantId: "project-1",
    evaluationId: "evaluation-1",
    version: "2026-06-20",
    occurredAtMs: OCCURRED_AT_MS,
    createdAtMs: OCCURRED_AT_MS,
    updatedAtMs: OCCURRED_AT_MS,
    evaluatorType: "langevals/llm_answer_match",
    evaluatorName: "Judge",
    status: "processed",
    isGuardrail: false,
    passed: true,
    score: 0.9,
    label: "match",
    model: null,
    traceId: "trace-1",
    userId: null,
    conversationId: null,
    customerId: null,
    origin: null,
    durationMs: 120,
    totalCost: null,
    nonBilledCost: null,
    attributes: {},
    startedAtMs: OCCURRED_AT_MS - 100,
    completedAtMs: OCCURRED_AT_MS + 20,
    ...overrides,
  };
}

function memoryTier() {
  const repositories = MemoryAnalyticsRepositories.create();
  return {
    ...repositories,
    evaluations: repositories.evaluations.open({ defaultRetentionDays: () => 30 }),
  };
}

describe("the analytics memory tier", () => {
  describe("when a tenant's session is resolved", () => {
    it("takes a write and answers a read with no rows, never refusing", async () => {
      const session = await memoryTier().sessions.resolve("project-1");

      await expect(
        session.insert({
          table: "evaluation_analytics",
          values: [{ TenantId: "project-1", EvaluationId: "evaluation-1" }],
          format: "JSONEachRow",
        }),
      ).resolves.toBeUndefined();
      const result = await session.query({
        query: "SELECT * FROM evaluation_analytics WHERE TenantId = {tenantId:String}",
        query_params: { tenantId: "project-1" },
        format: "JSONEachRow",
      });
      await expect(result.json()).resolves.toEqual([]);
    });
  });

  describe("when an evaluation row is upserted", () => {
    it("reads the row back with the events it applied", async () => {
      const { evaluations } = memoryTier();
      const row = evaluationRow();

      await evaluations.upsert({ row, retentionDays: 14, appliedEventIds: ["event-1"] });

      await expect(
        evaluations.findLatest({ tenantId: "project-1", evaluationId: "evaluation-1" }),
      ).resolves.toEqual([{ row, appliedEventIds: ["event-1"] }]);
    });

    it("reads only the newest version, as the deduped slim table does", async () => {
      const { evaluations } = memoryTier();
      const newer = evaluationRow({ updatedAtMs: OCCURRED_AT_MS + 5, status: "error" });

      await evaluations.upsertBatch([
        { row: newer, appliedEventIds: ["event-1", "event-2"] },
        { row: evaluationRow(), appliedEventIds: ["event-1"] },
      ]);

      const [latest] = await evaluations.findLatest({
        tenantId: "project-1",
        evaluationId: "evaluation-1",
      });
      expect(latest).toEqual({ row: newer, appliedEventIds: ["event-1", "event-2"] });
    });

    it("misses a read windowed away from the row's occurrence", async () => {
      const { evaluations } = memoryTier();
      await evaluations.upsert({ row: evaluationRow() });

      await expect(
        evaluations.findLatest({
          tenantId: "project-1",
          evaluationId: "evaluation-1",
          window: { fromMs: OCCURRED_AT_MS + 1, toMs: OCCURRED_AT_MS + 1_000 },
        }),
      ).resolves.toEqual([]);
    });

    it("keeps one tenant's rows from another tenant's read", async () => {
      const { evaluations } = memoryTier();
      await evaluations.upsert({ row: evaluationRow() });

      await expect(
        evaluations.findLatest({ tenantId: "project-2", evaluationId: "evaluation-1" }),
      ).resolves.toEqual([]);
    });

    it("refuses a batch that mixes tenants", async () => {
      const { evaluations } = memoryTier();

      await expect(
        evaluations.upsertBatch([
          { row: evaluationRow() },
          { row: evaluationRow({ tenantId: "project-2" }) },
        ]),
      ).rejects.toBeInstanceOf(SecurityError);
    });
  });

  describe("when the newest row of a source is asked for", () => {
    it("answers the newest evaluation occurrence the evaluation twin wrote", async () => {
      const { evaluations, recency } = memoryTier();
      await evaluations.upsert({ row: evaluationRow() });
      await evaluations.upsert({
        row: evaluationRow({ evaluationId: "evaluation-2", occurredAtMs: OCCURRED_AT_MS + 60 }),
      });

      await expect(
        recency.findLastOccurredAt({
          projectId: "project-1",
          source: "evaluation",
          since: Temporal.Instant.fromEpochMilliseconds(0),
        }),
      ).resolves.toEqual([Temporal.Instant.fromEpochMilliseconds(OCCURRED_AT_MS + 60)]);
    });

    it("answers nothing for evaluations older than the bound", async () => {
      const { evaluations, recency } = memoryTier();
      await evaluations.upsert({ row: evaluationRow() });

      await expect(
        recency.findLastOccurredAt({
          projectId: "project-1",
          source: "evaluation",
          since: nowInstant(),
        }),
      ).resolves.toEqual([]);
    });

    it("answers nothing for traces, which another module writes", async () => {
      await expect(
        memoryTier().recency.findLastOccurredAt({
          projectId: "project-1",
          source: "trace",
          since: Temporal.Instant.fromEpochMilliseconds(0),
        }),
      ).resolves.toEqual([]);
    });
  });

  it("answers a timeseries read with empty periods", async () => {
    const { analytics } = memoryTier();
    const input: AnalyticsTimeseriesInput = {
      projectId: "project-1",
      startDate: OCCURRED_AT_MS,
      endDate: OCCURRED_AT_MS + 60_000,
      filters: {},
      series: [],
      timeScale: 60,
      timeZone: "UTC",
    };

    await expect(
      analytics.runTimeseries({
        table: analytics.tableFor(input),
        tenantId: "project-1",
        input,
        startDate: nowInstant(),
        endDate: nowInstant(),
        previousPeriodStartDate: nowInstant(),
        adjustedTimeScale: 60,
        maxResultRows: undefined,
      }),
    ).resolves.toEqual({ previousPeriod: [], currentPeriod: [] });
  });

  it("answers the app-function store probe with nothing, as a silent server does", async () => {
    await expect(memoryTier().appFunctionStore.findProbe()).resolves.toEqual([]);
  });
});
