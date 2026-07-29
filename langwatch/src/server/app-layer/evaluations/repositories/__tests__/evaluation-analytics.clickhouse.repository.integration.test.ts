/**
 * @vitest-environment node
 * @integration
 *
 * Round-trips the slim evaluation_analytics table (migrations 00041 + 00056)
 * through its real INSERT/SELECT SQL against ClickHouse. The unit tests cover
 * the fold derivation and the pure fromRow decoder with no I/O; this proves the
 * DDL↔repository column contract plus the ADR-066 read-back path: the 00056
 * lifecycle columns (StartedAt / CompletedAt — the operands DurationMs is
 * derived from) survive the trip so store.get() reconstructs working state
 * without touching event_log, the AppliedEventIds watermark survives cache loss,
 * and a pre-00056 row whose body omits the columns decodes with null timestamps
 * rather than refolding.
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { EvaluationAnalyticsRow } from "~/server/event-sourcing/pipelines/evaluation-processing/projections/evaluationAnalytics.foldProjection";
import {
  startTestContainers,
  stopTestContainers,
} from "../../../../event-sourcing/__tests__/integration/testContainers";
import { EvaluationAnalyticsClickHouseRepository } from "../evaluation-analytics.clickhouse.repository";

let ch: ClickHouseClient;
let repo: EvaluationAnalyticsClickHouseRepository;

const tag = nanoid();
const tenantId = `${tag}-project`;
const baseMs = Date.now();
const window = { fromMs: baseMs - 60_000, toMs: baseMs + 60_000 };

function evalRow(
  over: Partial<EvaluationAnalyticsRow> = {},
): EvaluationAnalyticsRow {
  return {
    tenantId,
    evaluationId: `${tag}-e`,
    version: "2026-06-20",
    occurredAtMs: baseMs,
    createdAtMs: baseMs - 2000,
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
    durationMs: 1000,
    totalCost: null,
    nonBilledCost: null,
    attributes: { "metadata.team": "platform" },
    // Read-back state (migration 00056).
    startedAtMs: baseMs - 1000,
    completedAtMs: baseMs,
    ...over,
  };
}

beforeAll(async () => {
  const containers = await startTestContainers();
  ch = containers.clickHouseClient;
  repo = new EvaluationAnalyticsClickHouseRepository(async () => ch);
}, 60_000);

afterAll(async () => {
  if (ch) {
    await ch.exec({
      query: `ALTER TABLE evaluation_analytics DELETE WHERE TenantId = {tenantId:String}`,
      query_params: { tenantId },
    });
  }
  await stopTestContainers();
});

describe("evaluation_analytics round-trip (migrations 00041 + 00056)", () => {
  describe("given a fully populated slim row", () => {
    it("reads back the lifecycle operands so the fold recovers its state", async () => {
      const row = evalRow({ evaluationId: `${tag}-rt` });
      // Both write paths carry `wait_for_async_insert: 1`, so the row is
      // durably queryable once this resolves — the wait is a correctness
      // requirement for the next delivery's read-back, not a batch-only
      // nicety. The batch path is used here only because it is the store's.
      await repo.upsertBatch([{ row, retentionDays: 30 }]);

      const read = await repo.findByEvaluationIdWithApplied({
        tenantId,
        evaluationId: `${tag}-rt`,
        window,
      });

      expect(read).not.toBeNull();
      // Analytics columns.
      expect(read!.row.status).toBe("processed");
      expect(read!.row.score).toBeCloseTo(0.87);
      expect(read!.row.passed).toBe(true);
      expect(read!.row.label).toBe("match");
      expect(read!.row.evaluatorName).toBe("Judge");
      expect(read!.row.isGuardrail).toBe(true);
      expect(read!.row.durationMs).toBe(1000);
      // Read-back columns (00056) — exact ms round-trip.
      expect(read!.row.startedAtMs).toBe(baseMs - 1000);
      expect(read!.row.completedAtMs).toBe(baseMs);
    });
  });

  describe("given the same evaluation written twice", () => {
    it("dedups to the latest version (ReplacingMergeTree, no FINAL)", async () => {
      const row = evalRow({ evaluationId: `${tag}-dedup`, score: 0.5 });
      await repo.upsertBatch([{ row, retentionDays: 30 }]);
      // A higher updatedAtMs makes the second write the RMT-latest version
      // (the repo stamps UpdatedAt from row.updatedAtMs, not now()).
      await repo.upsertBatch([
        {
          row: { ...row, score: 0.95, updatedAtMs: baseMs + 1000 },
          retentionDays: 30,
        },
      ]);

      const read = await repo.findByEvaluationIdWithApplied({
        tenantId,
        evaluationId: `${tag}-dedup`,
        window,
      });

      expect(read!.row.score).toBeCloseTo(0.95);
    });
  });

  describe("given a row written with an applied-event-id watermark", () => {
    it("reads the watermark back next to the row (ADR-066)", async () => {
      const row = evalRow({ evaluationId: `${tag}-applied` });
      await repo.upsertBatch([
        { row, retentionDays: 30, appliedEventIds: ["ev-1", "ev-2"] },
      ]);

      const read = await repo.findByEvaluationIdWithApplied({
        tenantId,
        evaluationId: `${tag}-applied`,
        window,
      });

      expect(read!.appliedEventIds).toEqual(["ev-1", "ev-2"]);
    });
  });

  describe("given a pre-migration row that omits the 00056 columns", () => {
    it("decodes with null lifecycle timestamps instead of refolding", async () => {
      const evaluationId = `${tag}-legacy`;
      // A row written before migration 00056 emits a JSONEachRow body with none
      // of the read-back columns, so ClickHouse supplies each column default.
      await ch.insert({
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
      });

      const read = await repo.findByEvaluationIdWithApplied({
        tenantId,
        evaluationId,
        window,
      });

      expect(read).not.toBeNull();
      expect(read!.row.status).toBe("processed");
      // The absent 00056 columns come back as their defaults — never a refold.
      expect(read!.row.startedAtMs).toBeNull();
      expect(read!.row.completedAtMs).toBeNull();
      expect(read!.appliedEventIds).toEqual([]);
    });
  });
});
