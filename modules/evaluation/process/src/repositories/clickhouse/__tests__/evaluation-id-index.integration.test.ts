/**
 * @vitest-environment node
 * @see specs/clickhouse/id-index-reads.feature
 * A lookup of an evaluation run by id alone reads the partitions its id index names.
 */
import type { ClickHouseClient } from "@clickhouse/client";
import {
  AuthorizedClickHouse,
  ClickHouseQueryClient,
  type IdIndexFlags,
  type QueryDriver,
  type QueryRequest,
  setWindowedReadMetrics,
  TenantGuard,
  type WindowedReadOutcome,
} from "@langwatch/clickhouse-client";
import { generate } from "@langwatch/ksuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ownProof } from "../../../__tests__/support/authorization-proofs.fixture.ts";
import { startMigratedClickHouse } from "../../../__tests__/support/monitor-performance.fixtures.ts";
import { EvaluationRunClickHouseReadRepository } from "../evaluation-run-read.repository.ts";

const clickHouseUrl =
  process.env.LANGWATCH_TEST_CLICKHOUSE_URL ??
  process.env.TEST_CLICKHOUSE_URL ??
  process.env.CI_CLICKHOUSE_URL;

const DAY_MS = 24 * 60 * 60 * 1000;
const tenantId = `test-evaluation-id-index-${generate("test").toString()}`;
const nowMs = Date.now();
const eightWeeksAgoMs = nowMs - 56 * DAY_MS;
const retention = {
  findRetentionDays: async () => [365],
  getPlatformDefaultRetentionDays: () => 365,
};
const flagsOn: IdIndexFlags = { isOn: () => true };

let clickHouse: ClickHouseClient;
let repository: EvaluationRunClickHouseReadRepository;
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
      await client.insert({ table: request.table, values: request.rows, format: "JSONEachRow" });
    },
    async command(request) {
      await client.command({ query: request.sql });
    },
  };
  return new ClickHouseQueryClient({ tenantGuard: new TenantGuard(), driver });
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

  beforeAll(async () => {
    clickHouse = await startMigratedClickHouse();
    setWindowedReadMetrics({ record: (outcome) => void outcomes.push(outcome) });
    repository = EvaluationRunClickHouseReadRepository.create({
      clickhouse: new AuthorizedClickHouse({
        resolveClient: async () => recordingQueryClient(clickHouse),
      }),
    });
    await clickHouse.insert({
      table: "evaluation_runs",
      format: "JSONEachRow",
      values: [
        runRow({ evaluationId: targetId, scheduledAtMs: eightWeeksAgoMs }),
        runRow({ evaluationId: decoyId, scheduledAtMs: nowMs - 14 * DAY_MS }),
      ],
    });
  }, 300_000);

  afterAll(async () => {
    for (const table of ["evaluation_runs", "evaluation_runs_id_index"]) {
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
        idIndex: flagsOn,
      });

      expect(run.evaluationId).toBe(targetId);
      const read = statements.find(
        (statement) => statement.sql.includes("FROM evaluation_runs AS t") && statement.params,
      );
      expect(read?.params).toMatchObject({
        scheduledAtFrom: eightWeeksAgoMs - DAY_MS,
        scheduledAtTo: eightWeeksAgoMs + DAY_MS,
      });
      // Both the outer scope and the inner dedup subquery carry the bound.
      expect(read?.sql.match(/scheduledAtFrom/g)).toHaveLength(2);
      expect(outcomes).toEqual([{ table: "evaluation_runs", outcome: "index_hit" }]);
    });

    it("reads the same run through today's ladder when the flag is off", async () => {
      statements = [];

      const run = await repository.getByEvaluationId({
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
});
