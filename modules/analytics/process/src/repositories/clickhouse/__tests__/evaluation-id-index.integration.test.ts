/**
 * @vitest-environment node
 * @see specs/clickhouse/id-index-reads.feature
 * A lookup of an evaluation's analytics row by id alone reads the partitions its id index names.
 */
import { randomUUID } from "node:crypto";

import type { ClickHouseClient } from "@clickhouse/client";
import type { AnalyticsEvaluationRow } from "@langwatch/analytics-contract";
import {
  ClickHouseQueryClient,
  type IdIndexFlags,
  type QueryDriver,
  type QueryRequest,
  setWindowedReadMetrics,
  TenantGuard,
  type WindowedReadOutcome,
} from "@langwatch/clickhouse-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startMigratedClickHouse } from "../../../__tests__/migrated-clickhouse.harness.ts";
import { ClickHouseAnalyticsEvaluationRepository } from "../clickhouse.analytics-persistence.repository.ts";
import { ClickHouseAnalyticsSessionRepository } from "../clickhouse.analytics-session.repository.ts";

const clickHouseUrl =
  process.env.LANGWATCH_TEST_CLICKHOUSE_URL ??
  process.env.TEST_CLICKHOUSE_URL ??
  process.env.CI_CLICKHOUSE_URL;

const DAY_MS = 24 * 60 * 60 * 1000;
const tenantId = `test-analytics-id-index-${randomUUID()}`;
const nowMs = Date.now();
const eightWeeksAgoMs = nowMs - 56 * DAY_MS;
const flagsOn: IdIndexFlags = { isOn: () => true };

let clickHouse: ClickHouseClient;
let repository: ClickHouseAnalyticsEvaluationRepository;
let statements: QueryRequest[] = [];
const outcomes: { table: string; outcome: WindowedReadOutcome }[] = [];

/** The routed client over the migrated test server, keeping every statement it is asked. */
function recordingQueryClient(client: ClickHouseClient): ClickHouseQueryClient {
  const driver: QueryDriver = {
    async execute(request) {
      statements.push(request);
      const result = await client.query({
        query: request.sql,
        format: "JSONEachRow",
        ...(request.params === undefined ? {} : { query_params: request.params }),
        ...(request.settings === undefined ? {} : { clickhouse_settings: request.settings }),
      });
      return { rows: await result.json() };
    },
    async insert(request) {
      await client.insert({
        table: request.table,
        values: request.rows,
        format: "JSONEachRow",
        ...(request.settings === undefined ? {} : { clickhouse_settings: request.settings }),
      });
    },
    async command(request) {
      await client.command({ query: request.sql });
    },
  };
  return new ClickHouseQueryClient({ tenantGuard: new TenantGuard(), driver });
}

const evaluationRow = ({
  evaluationId,
  occurredAtMs,
}: {
  evaluationId: string;
  occurredAtMs: number;
}): AnalyticsEvaluationRow => ({
  tenantId,
  evaluationId,
  version: "2026-06-20",
  occurredAtMs,
  createdAtMs: occurredAtMs - 2_000,
  updatedAtMs: occurredAtMs + 10,
  evaluatorType: "langevals/llm_answer_match",
  evaluatorName: "Judge",
  status: "processed",
  isGuardrail: false,
  passed: true,
  score: 0.87,
  label: "match",
  model: null,
  traceId: `trace-${evaluationId}`,
  userId: null,
  conversationId: null,
  customerId: null,
  origin: null,
  durationMs: 1_000,
  totalCost: null,
  nonBilledCost: null,
  attributes: {},
  startedAtMs: occurredAtMs - 1_000,
  completedAtMs: occurredAtMs,
});

describe.skipIf(!clickHouseUrl)("a lookup of an evaluation's analytics row by id alone", () => {
  const targetId = `eval-target-${randomUUID()}`;
  const decoyId = `eval-decoy-${randomUUID()}`;

  beforeAll(async () => {
    ({ client: clickHouse } = await startMigratedClickHouse());
    setWindowedReadMetrics({ record: (outcome) => void outcomes.push(outcome) });
    const queryClient = recordingQueryClient(clickHouse);
    repository = ClickHouseAnalyticsEvaluationRepository.create({
      resolveClient: async (tenant) =>
        ClickHouseAnalyticsSessionRepository.create({ clickhouse: queryClient, tenantId: tenant }),
      defaultRetentionDays: () => 365,
      clickhouse: queryClient,
      idIndex: flagsOn,
    });
    await repository.upsertBatch([
      {
        row: evaluationRow({ evaluationId: targetId, occurredAtMs: eightWeeksAgoMs }),
        retentionDays: 365,
      },
      {
        row: evaluationRow({ evaluationId: decoyId, occurredAtMs: nowMs - 14 * DAY_MS }),
        retentionDays: 365,
      },
    ]);
  }, 300_000);

  afterAll(async () => {
    for (const table of ["evaluation_analytics", "evaluation_analytics_id_index"]) {
      await clickHouse?.command({
        query: `ALTER TABLE ${table} DELETE WHERE TenantId = {tenantId:String}`,
        query_params: { tenantId },
      });
    }
  });

  describe("given a row written eight weeks ago and its id index filled by the insert", () => {
    /** @scenario "a lookup by id reads only the partitions the index names" */
    it("bounds the read, inner dedup subquery included, to the index's range widened a day each side", async () => {
      statements = [];
      outcomes.length = 0;

      const [found] = await repository.findLatest({ tenantId, evaluationId: targetId });

      expect(found?.row.evaluationId).toBe(targetId);
      const read = statements.find((statement) =>
        statement.sql.includes("SELECT * FROM evaluation_analytics"),
      );
      expect(read?.params).toMatchObject({
        fromMs: eightWeeksAgoMs - DAY_MS,
        toMs: eightWeeksAgoMs + DAY_MS,
      });
      expect(read?.sql.match(/\{fromMs:Int64\}/g)).toHaveLength(2);
      expect(outcomes).toEqual([{ table: "evaluation_analytics", outcome: "index_hit" }]);
    });

    it("keeps the caller's window, and its unbounded inner subquery, when the window finds the row", async () => {
      statements = [];

      const [found] = await repository.findLatest({
        tenantId,
        evaluationId: targetId,
        window: { fromMs: eightWeeksAgoMs - 1_000, toMs: eightWeeksAgoMs + 1_000 },
      });

      expect(found?.row.evaluationId).toBe(targetId);
      const reads = statements.filter((statement) =>
        statement.sql.includes("SELECT * FROM evaluation_analytics"),
      );
      expect(reads).toHaveLength(1);
      expect(reads[0]?.sql.match(/\{fromMs:Int64\}/g)).toHaveLength(1);
    });
  });
});
