/**
 * @vitest-environment node
 * @see specs/clickhouse/id-index-reads.feature
 * A lookup of an evaluation's analytics row by id alone reads the partitions its id index names.
 */
import { randomUUID } from "node:crypto";

import type { ClickHouseClient } from "@clickhouse/client";
import type { AnalyticsEvaluationRow } from "@langwatch/analytics-contract";
import {
  type ClickHouseQueryClient,
  type InsertRequest,
  type QueryRequest,
  setWindowedReadMetrics,
  type WindowedReadOutcome,
} from "@langwatch/clickhouse-client";
import {
  idIndexedClientDouble,
  partsAfterPartitionPruning,
  readyIdIndexedClientDouble,
} from "@langwatch/clickhouse-client/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startMigratedClickHouse } from "../../../__tests__/migrated-clickhouse.harness.ts";
import { ANALYTICS_ID_INDEXES } from "../clickhouse.analytics-id-indexes.database.ts";
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

let clickHouse: ClickHouseClient;
let repository: ClickHouseAnalyticsEvaluationRepository;
let unflagged: ClickHouseAnalyticsEvaluationRepository;
let statements: QueryRequest[] = [];
const outcomes: { table: string; outcome: WindowedReadOutcome }[] = [];

/**
 * The routed client over the migrated test server, keeping every statement it is asked, with
 * the evaluation index read as filled when `ready` (no marker row is written to the server).
 */
function recordingQueryClient({
  client,
  ready,
}: {
  client: ClickHouseClient;
  ready: boolean;
}): Promise<ClickHouseQueryClient> {
  const driver = {
    async execute(request: QueryRequest) {
      statements.push(request);
      const result = await client.query({
        query: request.sql,
        format: "JSONEachRow",
        ...(request.params === undefined ? {} : { query_params: request.params }),
        ...(request.settings === undefined ? {} : { clickhouse_settings: request.settings }),
      });
      return { rows: await result.json() };
    },
    async insert(request: InsertRequest) {
      await client.insert({
        table: request.table,
        values: request.rows,
        format: "JSONEachRow",
        ...(request.settings === undefined ? {} : { clickhouse_settings: request.settings }),
      });
    },
  };
  return ready
    ? readyIdIndexedClientDouble({ indexes: ANALYTICS_ID_INDEXES, driver })
    : Promise.resolve(idIndexedClientDouble({ indexes: ANALYTICS_ID_INDEXES, driver }));
}

/** One query on the test server, its rows as JSONEachRow parses them. */
async function queryRows(query: string, params?: Record<string, unknown>): Promise<unknown[]> {
  const result = await clickHouse.query({
    query,
    format: "JSONEachRow",
    ...(params === undefined ? {} : { query_params: params }),
  });
  return result.json();
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
    const over = (queryClient: ClickHouseQueryClient) =>
      ClickHouseAnalyticsEvaluationRepository.create({
        resolveClient: async (tenant: string) =>
          ClickHouseAnalyticsSessionRepository.create({
            clickhouse: queryClient,
            tenantId: tenant,
          }),
        defaultRetentionDays: () => 365,
        clickhouse: queryClient,
      });
    repository = over(await recordingQueryClient({ client: clickHouse, ready: true }));
    unflagged = over(await recordingQueryClient({ client: clickHouse, ready: false }));
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
        idBound_fromMs: eightWeeksAgoMs - DAY_MS,
        idBound_toMs: eightWeeksAgoMs + DAY_MS,
      });
      expect(read?.sql.match(/\{idBound_fromMs:Int64\}/g)).toHaveLength(2);
      expect(outcomes).toEqual([{ table: "evaluation_analytics", outcome: "index_hit" }]);
      if (read === undefined) throw new Error("no source read of evaluation_analytics was sent");
      statements = [];
      await unflagged.findLatest({ tenantId, evaluationId: targetId });
      const unbounded = statements.find((statement) =>
        statement.sql.includes("SELECT * FROM evaluation_analytics"),
      );
      if (unbounded === undefined) throw new Error("no unbounded read was sent");
      expect(await partsAfterPartitionPruning({ query: queryRows, request: read })).toBeLessThan(
        await partsAfterPartitionPruning({ query: queryRows, request: unbounded }),
      );
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
