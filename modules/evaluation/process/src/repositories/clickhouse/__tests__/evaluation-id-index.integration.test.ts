/**
 * @vitest-environment node
 * @see specs/clickhouse/id-index-reads.feature
 * A lookup of an evaluation run by id alone reads the partitions its id index names.
 */
import type { ClickHouseClient } from "@clickhouse/client";
import {
  AuthorizedClickHouse,
  type ClickHouseQueryClient,
  type QueryRequest,
  setWindowedReadMetrics,
  type WindowedReadOutcome,
} from "@langwatch/clickhouse-client";
import {
  idIndexedClientDouble,
  partsAfterPartitionPruning,
  readyIdIndexedClientDouble,
} from "@langwatch/clickhouse-client/testing";
import { generate } from "@langwatch/ksuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ownProof } from "../../../__tests__/support/authorization-proofs.fixture.ts";
import { startMigratedClickHouse } from "../../../__tests__/support/monitor-performance.fixtures.ts";
import {
  EVALUATION_ID_INDEXES,
  EVALUATION_SECOND_ID_INDEXES,
} from "../clickhouse.evaluation-id-indexes.database.ts";
import { EvaluationRunClickHouseReadRepository } from "../evaluation-run-read.repository.ts";

const clickHouseUrl =
  process.env.LANGWATCH_TEST_CLICKHOUSE_URL ??
  process.env.TEST_CLICKHOUSE_URL ??
  process.env.CI_CLICKHOUSE_URL;

const DAY_MS = 24 * 60 * 60 * 1000;
const tenantId = `test-evaluation-id-index-${generate("test").toString()}`;
const nowMs = Date.now();
const eightWeeksAgoMs = nowMs - 56 * DAY_MS;
const twoDaysAgoMs = nowMs - 2 * DAY_MS;
const retention = {
  findRetentionDays: async () => [365],
  getPlatformDefaultRetentionDays: () => 365,
};

let clickHouse: ClickHouseClient;
let repository: EvaluationRunClickHouseReadRepository;
let notReady: EvaluationRunClickHouseReadRepository;
let statements: QueryRequest[] = [];
const outcomes: { table: string; outcome: WindowedReadOutcome }[] = [];

/**
 * The routed client over the migrated test server, keeping every statement it is asked, with
 * the run index read as filled when `ready` (no marker row is written to the shared server).
 */
function recordingQueryClient({
  client,
  ready,
}: {
  client: ClickHouseClient;
  ready: boolean;
}): Promise<ClickHouseQueryClient> {
  const make = ready ? readyIdIndexedClientDouble : idIndexedClientDouble;
  return Promise.resolve(
    make({
      indexes: [...EVALUATION_ID_INDEXES, ...EVALUATION_SECOND_ID_INDEXES],
      driver: {
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
      },
    }),
  );
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

const runRow = ({
  evaluationId,
  scheduledAtMs,
}: {
  evaluationId: string;
  scheduledAtMs: number;
}) => ({
  ProjectionId: `projection-${evaluationId}`,
  TenantId: tenantId,
  EvaluationId: evaluationId,
  Version: "1",
  EvaluatorId: "evaluator_1",
  EvaluatorType: "langevals/test",
  TraceId: `trace-${evaluationId}`,
  Status: "processed",
  ScheduledAt: new Date(scheduledAtMs),
  UpdatedAt: new Date(scheduledAtMs),
  LastProcessedEventId: `event-${evaluationId}`,
  _retention_days: 365,
});

describe.skipIf(!clickHouseUrl)("a lookup of an evaluation run by id alone", () => {
  const targetId = `eval-target-${generate("test").toString()}`;
  const decoyId = `eval-decoy-${generate("test").toString()}`;
  const tracedId = `eval-traced-${generate("test").toString()}`;

  beforeAll(async () => {
    clickHouse = await startMigratedClickHouse();
    setWindowedReadMetrics({ record: (outcome) => void outcomes.push(outcome) });
    const ready = recordingQueryClient({ client: clickHouse, ready: true });
    const unready = recordingQueryClient({ client: clickHouse, ready: false });
    repository = EvaluationRunClickHouseReadRepository.create({
      clickhouse: new AuthorizedClickHouse({ resolveClient: () => ready }),
    });
    notReady = EvaluationRunClickHouseReadRepository.create({
      clickhouse: new AuthorizedClickHouse({ resolveClient: () => unready }),
    });
    await clickHouse.insert({
      table: "evaluation_runs",
      format: "JSONEachRow",
      values: [
        runRow({ evaluationId: targetId, scheduledAtMs: eightWeeksAgoMs }),
        runRow({ evaluationId: decoyId, scheduledAtMs: nowMs - 14 * DAY_MS }),
        runRow({ evaluationId: tracedId, scheduledAtMs: twoDaysAgoMs }),
      ],
    });
  }, 300_000);

  afterAll(async () => {
    for (const table of [
      "evaluation_runs",
      "evaluation_runs_id_index",
      "evaluation_runs_by_trace_id_index",
    ]) {
      await clickHouse?.command({
        query: `ALTER TABLE ${table} DELETE WHERE TenantId = {tenantId:String}`,
        query_params: { tenantId },
      });
    }
    await clickHouse?.close();
  });

  describe("given a run written eight weeks ago and its id index filled by the insert", () => {
    /** @scenario "a lookup by id reads only the partitions the index names" */
    it("bounds the read to the index's range widened a day each side and counts an index hit", async () => {
      statements = [];
      outcomes.length = 0;

      const run = await repository.getByEvaluationId({
        authorization: ownProof({ projectId: tenantId }),
        evaluationId: targetId,
        retention,
      });

      expect(run.evaluationId).toBe(targetId);
      const read = statements.find(
        (statement) => statement.sql.includes("FROM evaluation_runs AS t") && statement.params,
      );
      expect(read?.params).toMatchObject({
        idBound_fromMs: eightWeeksAgoMs - DAY_MS,
        idBound_toMs: eightWeeksAgoMs + DAY_MS,
      });
      // Both the outer scope and the inner dedup subquery carry the bound.
      expect(read?.sql.match(/idBound_fromMs/g)).toHaveLength(2);
      expect(outcomes).toEqual([{ table: "evaluation_runs", outcome: "index_hit" }]);
      if (read === undefined) throw new Error("no source read of evaluation_runs was sent");
      const unbounded = {
        sql: "SELECT EvaluationId FROM evaluation_runs WHERE TenantId = {tenantId:String} AND EvaluationId = {evaluationId:String}",
        params: { tenantId, evaluationId: targetId },
      };
      const boundedParts = await partsAfterPartitionPruning({ query: queryRows, request: read });
      expect(boundedParts).toBe(1);
      expect(boundedParts).toBeLessThan(
        await partsAfterPartitionPruning({ query: queryRows, request: unbounded }),
      );
    });

    it("reads the same run through today's ladder while the index is not ready", async () => {
      statements = [];

      const run = await notReady.getByEvaluationId({
        authorization: ownProof({ projectId: tenantId }),
        evaluationId: targetId,
        retention,
      });

      expect(run.evaluationId).toBe(targetId);
      expect(
        statements.some((statement) => statement.sql.includes("evaluation_runs_id_index")),
      ).toBe(false);
    });
  });

  describe("given a run with a trace, read by its trace id alone (the second id index)", () => {
    /** @scenario "a lookup by id reads only the partitions the index names" */
    it("bounds the read to the trace index's range inside the seven-day lookback", async () => {
      statements = [];
      outcomes.length = 0;

      const runs = await repository.findByTraceId({
        authorization: ownProof({ projectId: tenantId }),
        traceId: `trace-${tracedId}`,
      });

      expect(runs.map((run) => run.evaluationId)).toEqual([tracedId]);
      const read = statements.find(
        (statement) => statement.sql.includes("FROM evaluation_runs AS runs") && statement.params,
      );
      expect(read?.params).toMatchObject({
        idBound_fromMs: twoDaysAgoMs - DAY_MS,
        idBound_toMs: twoDaysAgoMs + DAY_MS,
      });
      expect(read?.sql.match(/idBound_fromMs/g)).toHaveLength(2);
      expect(outcomes).toContainEqual({ table: "evaluation_runs", outcome: "index_hit" });
    });

    it("reads the same run inside the lookback while the trace index is not ready", async () => {
      statements = [];

      const runs = await notReady.findByTraceId({
        authorization: ownProof({ projectId: tenantId }),
        traceId: `trace-${tracedId}`,
      });

      expect(runs.map((run) => run.evaluationId)).toEqual([tracedId]);
      expect(
        statements.some((statement) => statement.sql.includes("evaluation_runs_by_trace_id_index")),
      ).toBe(false);
    });
  });

  describe("given runs read for a batch of traces (the second id index)", () => {
    /** @scenario "A batch of traces' earlier evaluations is read through the trace id index" */
    it("bounds the batch read and its latest-version subquery to the trace index's range", async () => {
      statements = [];
      outcomes.length = 0;

      const found = await repository.findTraceEvaluations({
        authorization: ownProof({ projectId: tenantId }),
        traceIds: [`trace-${tracedId}`, `trace-absent-${tracedId}`],
      });

      expect(found.map((run) => run.evaluationId)).toEqual([tracedId]);
      const read = statements.find(
        (statement) => statement.sql.includes("FROM evaluation_runs AS runs") && statement.params,
      );
      expect(read?.params).toMatchObject({
        idBound_fromMs: expect.any(Number),
        idBound_toMs: expect.any(Number),
      });
      expect(read?.sql.match(/idBound_fromMs/g)).toHaveLength(2);
      expect(outcomes).toContainEqual({ table: "evaluation_runs", outcome: "index_hit" });
    });

    /** @scenario "A batch of traces' earlier evaluations is read through the trace id index" */
    it("reads the same runs with no time bound while the trace index is not ready", async () => {
      statements = [];

      const found = await notReady.findTraceEvaluations({
        authorization: ownProof({ projectId: tenantId }),
        traceIds: [`trace-${tracedId}`, `trace-absent-${tracedId}`],
      });

      expect(found.map((run) => run.evaluationId)).toEqual([tracedId]);
      const read = statements.find((statement) =>
        statement.sql.includes("FROM evaluation_runs AS runs"),
      );
      expect(read?.sql).not.toContain("idBound_fromMs");
    });
  });
});
