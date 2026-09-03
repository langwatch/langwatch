import { env as nodeProcessEnv } from "node:process";
import {
  type AnalyticsEvaluationReadMetrics,
  type AnalyticsEvaluationRow,
} from "@langwatch/analytics-contract";
import { describe, expect, it, vi } from "vitest";
import { ClickHouseAnalyticsEvaluationRepository } from "../../../testing";
import type { EvaluationAnalyticsClickHouseClient } from "../clickhouse.analytics-persistence.repository";

const loggerSpies = vi.hoisted(() => ({ warn: vi.fn() }));

vi.mock("@langwatch/observability", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@langwatch/observability")>()),
  createLogger: () => loggerSpies,
}));

const row: AnalyticsEvaluationRow = {
  tenantId: "project-evaluation-analytics",
  evaluationId: "evaluation-1",
  version: "2026-06-20",
  occurredAtMs: 1_750_000_000_000,
  createdAtMs: 1_750_000_000_000,
  updatedAtMs: 1_750_000_000_000,
  evaluatorType: "langevals/llm_answer_match",
  evaluatorName: "Judge",
  status: "processed",
  isGuardrail: false,
  passed: true,
  score: 0.9,
  label: "match",
  model: "gpt-5-mini",
  traceId: "trace-1",
  userId: null,
  conversationId: null,
  customerId: null,
  origin: null,
  durationMs: 120,
  totalCost: null,
  nonBilledCost: null,
  attributes: { "metadata.team": "platform" },
  startedAtMs: 1_749_999_999_900,
  completedAtMs: 1_750_000_000_020,
};

function clientReturning(rows: Record<string, unknown>[]): EvaluationAnalyticsClickHouseClient {
  return {
    query: vi.fn(async () => ({ json: async () => rows })),
    insert: vi.fn(async () => void 0),
  };
}

function repository(
  client: EvaluationAnalyticsClickHouseClient,
  metrics: AnalyticsEvaluationReadMetrics = { record: () => {} },
): ClickHouseAnalyticsEvaluationRepository {
  return ClickHouseAnalyticsEvaluationRepository.create({
    resolveClient: async () => client,
    defaultRetentionDays: 30,
    readMetrics: metrics,
  });
}

describe("AnalyticsEvaluationRepository", () => {
  /** @scenario "Evaluation projections use the canonical Analytics persistence capability" */
  it("writes the complete evaluation row with strict insert settings", async () => {
    const client = clientReturning([]);
    const analytics = repository(client);

    await analytics.upsert({ row, retentionDays: 14, appliedEventIds: ["event-1"] });

    expect(client.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        table: "evaluation_analytics",
        format: "JSONEachRow",
        clickhouse_settings: expect.objectContaining({
          input_format_skip_unknown_fields: 0,
        }),
      }),
    );
  });

  it("uses strict insert settings for a batch too", async () => {
    const client = clientReturning([]);
    const analytics = repository(client);

    await analytics.upsertBatch([{ row, retentionDays: 14, appliedEventIds: ["event-1"] }]);

    expect(client.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        clickhouse_settings: expect.objectContaining({
          input_format_skip_unknown_fields: 0,
        }),
      }),
    );
  });

  /** @scenario "Evaluation projections use the canonical Analytics persistence capability" */
  it("appends a derived bucket to the rollup table and refuses a malformed one", async () => {
    const client = clientReturning([]);
    const analytics = repository(client);
    const bucket = {
      tenantId: row.tenantId,
      bucketStart: new Date(row.occurredAtMs),
      evaluatorType: row.evaluatorType,
      status: row.status,
      evalCount: 1,
      passCount: 1,
      failCount: 0,
      errorCount: 0,
      skippedCount: 0,
      scoreSum: 0.9,
      scoreCount: 1,
      durationSum: 120,
      costSum: 0,
      nonBilledCostSum: 0,
    };

    await analytics.appendRollup({ row: bucket, retentionDays: 14 });

    expect(client.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        table: "evaluation_analytics_rollup",
        format: "JSONEachRow",
      }),
    );

    await expect(
      analytics.appendRollup({ row: { ...bucket, evalCount: Number.NaN } }),
    ).rejects.toThrow();
    expect(client.insert).toHaveBeenCalledTimes(1);
  });

  it("reads the newest row and records bounded-read outcomes", async () => {
    const metrics: Array<{ outcome: string }> = [];
    const client = clientReturning([
      {
        TenantId: row.tenantId,
        EvaluationId: row.evaluationId,
        Version: row.version,
        OccurredAt: "2025-06-15 15:06:40.000",
        CreatedAt: "2025-06-15 15:06:40.000",
        UpdatedAt: "2025-06-15 15:06:40.000",
        EvaluatorType: row.evaluatorType,
        Status: row.status,
        IsGuardrail: 0,
        Passed: 1,
        Score: 0.9,
        DurationMs: "120",
        StartedAt: "1749999999900",
        CompletedAt: "1750000000020",
        AppliedEventIds: ["event-1"],
      },
    ]);
    const analytics = repository(client, {
      record: ({ outcome }) => metrics.push({ outcome }),
    });

    const result = await analytics.tryFind({
      tenantId: row.tenantId,
      evaluationId: row.evaluationId,
      window: { fromMs: row.occurredAtMs - 1000, toMs: row.occurredAtMs + 1000 },
    });

    expect(result?.row.evaluationId).toBe(row.evaluationId);
    expect(result?.appliedEventIds).toEqual(["event-1"]);
    expect(metrics).toEqual([{ outcome: "hit" }]);
  });

  it("rejects mixed-tenant batches before writing", async () => {
    const client = clientReturning([]);
    const analytics = repository(client);

    await expect(
      analytics.upsertBatch([{ row }, { row: { ...row, tenantId: "project-other" } }]),
    ).rejects.toThrow();
    expect(client.insert).not.toHaveBeenCalled();
  });

  it("decodes timezone-less DateTime64 values as UTC on a non-UTC host", async () => {
    nodeProcessEnv.TZ = "Asia/Kolkata";
    expect(new Date().getTimezoneOffset()).not.toBe(0);
    const client = clientReturning([
      {
        TenantId: row.tenantId,
        EvaluationId: row.evaluationId,
        Version: row.version,
        OccurredAt: "2026-07-24 12:00:00.123",
        CreatedAt: "2026-07-24 12:00:01.000",
        UpdatedAt: "2026-07-24 12:00:02.500",
      },
    ]);

    const result = await repository(client).tryFind({
      tenantId: row.tenantId,
      evaluationId: row.evaluationId,
    });

    expect(result?.row.occurredAtMs).toBe(Date.UTC(2026, 6, 24, 12, 0, 0, 123));
    expect(result?.row.createdAtMs).toBe(Date.UTC(2026, 6, 24, 12, 0, 1, 0));
    expect(result?.row.updatedAtMs).toBe(Date.UTC(2026, 6, 24, 12, 0, 2, 500));
  });

  it("breaks tied UpdatedAt versions by folded lifecycle progress", async () => {
    const client = clientReturning([]);
    await repository(client).tryFind({
      tenantId: row.tenantId,
      evaluationId: row.evaluationId,
    });

    expect(client.query).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.stringContaining(
          "ORDER BY OccurredAt DESC, CompletedAt DESC, StartedAt DESC,\n            length(AppliedEventIds) DESC",
        ),
      }),
    );
  });

  it("records empty bounded reads and unwindowed reads as distinct outcomes", async () => {
    const outcomes: string[] = [];
    const analytics = repository(clientReturning([]), {
      record: ({ outcome }) => outcomes.push(outcome),
    });

    await analytics.tryFind({
      tenantId: row.tenantId,
      evaluationId: row.evaluationId,
      window: { fromMs: row.occurredAtMs - 1, toMs: row.occurredAtMs + 1 },
    });
    await analytics.tryFind({ tenantId: row.tenantId, evaluationId: row.evaluationId });

    expect(outcomes).toEqual(["windowed_empty", "unwindowed"]);
  });

  it("applies an evaluation window only to the outer latest-version read", async () => {
    const client = clientReturning([]);
    await repository(client).tryFind({
      tenantId: row.tenantId,
      evaluationId: row.evaluationId,
      window: { fromMs: row.occurredAtMs - 1, toMs: row.occurredAtMs + 1 },
    });

    const query = vi.mocked(client.query).mock.calls[0]?.[0].query ?? "";
    const innerStart = query.indexOf("IN (");
    const outer = query.slice(0, innerStart);
    const inner = query.slice(innerStart, query.indexOf("GROUP BY"));
    expect(outer).toContain("fromUnixTimestamp64Milli");
    expect(inner).not.toContain("fromUnixTimestamp64Milli");
  });

  it("warns and rethrows the original ClickHouse write failure", async () => {
    const failure = new Error("ClickHouse unavailable");
    const client = clientReturning([]);
    vi.mocked(client.insert).mockRejectedValue(failure);
    loggerSpies.warn.mockClear();

    await expect(repository(client).upsert({ row })).rejects.toBe(failure);

    expect(loggerSpies.warn).toHaveBeenCalledWith(
      expect.objectContaining({ evaluationId: row.evaluationId, error: failure }),
      expect.stringMatching(/failed to upsert/i),
    );
  });

  it("warns and rethrows the original ClickHouse batch failure", async () => {
    const failure = new Error("ClickHouse unavailable");
    const client = clientReturning([]);
    vi.mocked(client.insert).mockRejectedValue(failure);
    loggerSpies.warn.mockClear();

    await expect(repository(client).upsertBatch([{ row }])).rejects.toBe(failure);

    expect(loggerSpies.warn).toHaveBeenCalledWith(
      expect.objectContaining({ count: 1, error: failure }),
      expect.stringMatching(/failed to batch upsert/i),
    );
  });

  it("warns and rethrows the original ClickHouse read failure", async () => {
    const failure = new Error("ClickHouse unavailable");
    const client = clientReturning([]);
    vi.mocked(client.query).mockRejectedValue(failure);
    const outcomes: string[] = [];
    loggerSpies.warn.mockClear();

    await expect(
      repository(client, { record: ({ outcome }) => outcomes.push(outcome) }).tryFind({
        tenantId: row.tenantId,
        evaluationId: row.evaluationId,
      }),
    ).rejects.toBe(failure);

    expect(outcomes).toEqual(["error"]);
    expect(loggerSpies.warn).toHaveBeenCalledWith(
      expect.objectContaining({ evaluationId: row.evaluationId, error: failure }),
      expect.stringMatching(/failed to read/i),
    );
  });
});
