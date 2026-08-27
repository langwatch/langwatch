/**
 * @vitest-environment node
 * @integration
 *
 * The package-owned ClickHouse contract for the evaluation_analytics slim
 * table. The app integration suite used to own this coverage; keeping it
 * beside the Analytics repository makes the table owner and its read-back
 * columns impossible to miss during the app split.
 *
 * The schema is supplied by the existing ClickHouse test service/global setup.
 * This suite deliberately creates no tables and does not carry a second DDL.
 */
import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import type { AnalyticsEvaluationRow } from "@langwatch/analytics-contract";
import { ClickHouseAnalyticsEvaluationRepository } from "../src/testing";

const configuredClickHouseUrl = process.env.TEST_CLICKHOUSE_URL ?? process.env.CI_CLICKHOUSE_URL;
const databaseUrl = configuredClickHouseUrl ? new URL(configuredClickHouseUrl) : null;
if (databaseUrl && !process.env.TEST_CLICKHOUSE_URL) {
  databaseUrl.pathname = "/test_langwatch";
}
const tag = randomUUID();
const tenantId = `${tag}-project`;
const baseMs = Date.now();
const window = { fromMs: baseMs - 60_000, toMs: baseMs + 60_000 };

let client: ClickHouseClient | undefined;

function evaluationRow(overrides: Partial<AnalyticsEvaluationRow> = {}): AnalyticsEvaluationRow {
  return {
    tenantId,
    evaluationId: `${tag}-evaluation`,
    version: "2026-06-20",
    occurredAtMs: baseMs,
    createdAtMs: baseMs - 2_000,
    updatedAtMs: baseMs + 10,
    evaluatorType: "langevals/llm_answer_match",
    evaluatorName: "Judge",
    status: "processed",
    isGuardrail: true,
    passed: true,
    score: 0.87,
    label: "match",
    model: "gpt-5-mini",
    traceId: `${tag}-trace`,
    userId: null,
    conversationId: null,
    customerId: null,
    origin: null,
    durationMs: 1_000,
    totalCost: null,
    nonBilledCost: null,
    attributes: { "metadata.team": "platform" },
    startedAtMs: baseMs - 1_000,
    completedAtMs: baseMs,
    ...overrides,
  };
}

const integration = describe.skipIf(databaseUrl === null);

afterAll(async () => {
  if (!client) return;
  await client.command({
    query: "ALTER TABLE evaluation_analytics DELETE WHERE TenantId = {tenantId:String}",
    query_params: { tenantId },
  });
  await client.close();
  client = undefined;
});

function repository(): ClickHouseAnalyticsEvaluationRepository {
  if (!databaseUrl) throw new Error("ClickHouse integration environment is unavailable");
  client ??= createClient({
    url: databaseUrl,
    clickhouse_settings: { date_time_input_format: "best_effort" },
  });
  return ClickHouseAnalyticsEvaluationRepository.create({
    resolveClient: async () => client ?? null,
    defaultRetentionDays: 30,
  });
}

integration("evaluation_analytics ClickHouse contract", () => {
  it("round-trips lifecycle operands and the applied-event watermark", async () => {
    const repo = repository();
    const row = evaluationRow({ evaluationId: `${tag}-round-trip` });

    await repo.upsertBatch([{ row, retentionDays: 30, appliedEventIds: ["event-1", "event-2"] }]);

    const result = await repo.tryFind({
      tenantId,
      evaluationId: row.evaluationId,
      window,
    });

    expect(result).not.toBeNull();
    expect(result?.row.status).toBe("processed");
    expect(result?.row.score).toBeCloseTo(0.87);
    expect(result?.row.passed).toBe(true);
    expect(result?.row.label).toBe("match");
    expect(result?.row.evaluatorName).toBe("Judge");
    expect(result?.row.isGuardrail).toBe(true);
    expect(result?.row.durationMs).toBe(1_000);
    expect(result?.row.startedAtMs).toBe(baseMs - 1_000);
    expect(result?.row.completedAtMs).toBe(baseMs);
    expect(result?.appliedEventIds).toEqual(["event-1", "event-2"]);
  });

  it("returns the newest version for a repeated evaluation", async () => {
    const repo = repository();
    const row = evaluationRow({ evaluationId: `${tag}-dedup`, score: 0.5 });

    await repo.upsertBatch([{ row, retentionDays: 30 }]);
    await repo.upsertBatch([
      {
        row: { ...row, score: 0.95, updatedAtMs: baseMs + 1_000 },
        retentionDays: 30,
      },
    ]);

    const result = await repo.tryFind({
      tenantId,
      evaluationId: row.evaluationId,
      window,
    });

    expect(result?.row.score).toBeCloseTo(0.95);
  });

  it("prefers the latest OccurredAt before later lifecycle operands", async () => {
    const repo = repository();
    const evaluationId = `${tag}-occurred-at-precedence`;
    const updatedAtMs = baseMs + 2_000;

    await repo.upsertBatch([
      {
        row: evaluationRow({
          evaluationId,
          score: 0.11,
          occurredAtMs: baseMs + 100,
          updatedAtMs,
          completedAtMs: baseMs + 900,
          startedAtMs: baseMs + 800,
        }),
        retentionDays: 30,
        appliedEventIds: ["event-1", "event-2"],
      },
      {
        row: evaluationRow({
          evaluationId,
          score: 0.22,
          occurredAtMs: baseMs + 101,
          updatedAtMs,
          completedAtMs: baseMs + 1,
          startedAtMs: baseMs,
        }),
        retentionDays: 30,
      },
    ]);

    const result = await repo.tryFind({ tenantId, evaluationId, window });

    expect(result?.row.score).toBeCloseTo(0.22);
    expect(result?.row.occurredAtMs).toBe(baseMs + 101);
  });

  it("breaks equal OccurredAt rows by latest CompletedAt", async () => {
    const repo = repository();
    const evaluationId = `${tag}-completed-at-precedence`;
    const updatedAtMs = baseMs + 3_000;

    await repo.upsertBatch([
      {
        row: evaluationRow({
          evaluationId,
          score: 0.31,
          occurredAtMs: baseMs + 200,
          updatedAtMs,
          completedAtMs: baseMs + 20,
        }),
        retentionDays: 30,
      },
      {
        row: evaluationRow({
          evaluationId,
          score: 0.32,
          occurredAtMs: baseMs + 200,
          updatedAtMs,
          completedAtMs: baseMs + 21,
        }),
        retentionDays: 30,
      },
    ]);

    const result = await repo.tryFind({ tenantId, evaluationId, window });

    expect(result?.row.score).toBeCloseTo(0.32);
    expect(result?.row.completedAtMs).toBe(baseMs + 21);
  });

  it("uses StartedAt only after equal OccurredAt and CompletedAt", async () => {
    const repo = repository();
    const evaluationId = `${tag}-started-at-precedence`;
    const updatedAtMs = baseMs + 4_000;

    await repo.upsertBatch([
      {
        row: evaluationRow({
          evaluationId,
          score: 0.41,
          occurredAtMs: baseMs + 300,
          updatedAtMs,
          completedAtMs: baseMs + 30,
          startedAtMs: baseMs + 10,
        }),
        retentionDays: 30,
      },
      {
        row: evaluationRow({
          evaluationId,
          score: 0.42,
          occurredAtMs: baseMs + 300,
          updatedAtMs,
          completedAtMs: baseMs + 30,
          startedAtMs: baseMs + 11,
        }),
        retentionDays: 30,
      },
    ]);

    const result = await repo.tryFind({ tenantId, evaluationId, window });

    expect(result?.row.score).toBeCloseTo(0.42);
    expect(result?.row.startedAtMs).toBe(baseMs + 11);
  });

  it("uses the applied-event leading key after tied lifecycle operands", async () => {
    const repo = repository();
    const evaluationId = `${tag}-applied-event-precedence`;
    const updatedAtMs = baseMs + 4_500;
    const occurredAtMs = baseMs + 350;
    const completedAtMs = baseMs + 35;
    const startedAtMs = baseMs + 12;

    await repo.upsertBatch([
      {
        row: evaluationRow({
          evaluationId,
          score: 0.61,
          occurredAtMs,
          updatedAtMs,
          completedAtMs,
          startedAtMs,
        }),
        retentionDays: 30,
        appliedEventIds: ["event-1"],
      },
      {
        row: evaluationRow({
          evaluationId,
          score: 0.62,
          occurredAtMs,
          updatedAtMs,
          completedAtMs,
          startedAtMs,
        }),
        retentionDays: 30,
        appliedEventIds: ["event-1", "event-2"],
      },
    ]);

    const result = await repo.tryFind({ tenantId, evaluationId, window });

    expect(result?.row.score).toBeCloseTo(0.62);
    expect(result?.appliedEventIds).toEqual(["event-1", "event-2"]);
  });

  it("round-trips exact odd-width window parameters", async () => {
    const repo = repository();
    const fromMs = baseMs + 1;
    const toMs = fromMs + 7;
    const beforeWindowId = `${tag}-odd-window-before`;
    const insideWindowId = `${tag}-odd-window-inside`;
    const afterWindowId = `${tag}-odd-window-after`;

    await repo.upsertBatch([
      {
        row: evaluationRow({
          evaluationId: beforeWindowId,
          score: 0.5,
          occurredAtMs: fromMs - 1,
          updatedAtMs: baseMs + 5_000,
        }),
        retentionDays: 30,
      },
      {
        row: evaluationRow({
          evaluationId: insideWindowId,
          score: 0.51,
          occurredAtMs: fromMs + 3,
          updatedAtMs: baseMs + 5_000,
        }),
        retentionDays: 30,
      },
      {
        row: evaluationRow({
          evaluationId: afterWindowId,
          score: 0.52,
          occurredAtMs: toMs + 1,
          updatedAtMs: baseMs + 5_000,
        }),
        retentionDays: 30,
      },
    ]);

    const window = { fromMs, toMs };
    const [before, inside, after] = await Promise.all([
      repo.tryFind({ tenantId, evaluationId: beforeWindowId, window }),
      repo.tryFind({ tenantId, evaluationId: insideWindowId, window }),
      repo.tryFind({ tenantId, evaluationId: afterWindowId, window }),
    ]);

    expect(before).toBeNull();
    expect(inside?.row.score).toBeCloseTo(0.51);
    expect(inside?.row.occurredAtMs).toBe(fromMs + 3);
    expect(after).toBeNull();
  });

  it("reads a pre-read-back row with null lifecycle operands", async () => {
    const repo = repository();
    const evaluationId = `${tag}-legacy`;

    if (!client) throw new Error("ClickHouse client was not initialised");
    await client.insert({
      table: "evaluation_analytics",
      values: [
        {
          TenantId: tenantId,
          EvaluationId: evaluationId,
          Version: "2026-06-20",
          OccurredAt: new Date(baseMs),
          Status: "processed",
          EvaluatorType: "langevals/llm_answer_match",
        },
      ],
      format: "JSONEachRow",
      clickhouse_settings: { async_insert: 1, wait_for_async_insert: 1 },
    });

    const result = await repo.tryFind({ tenantId, evaluationId, window });

    expect(result?.row.status).toBe("processed");
    expect(result?.row.startedAtMs).toBeNull();
    expect(result?.row.completedAtMs).toBeNull();
    expect(result?.appliedEventIds).toEqual([]);
  });
});
