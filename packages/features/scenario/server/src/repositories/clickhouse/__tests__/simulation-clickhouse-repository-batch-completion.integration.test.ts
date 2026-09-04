/**
 * Batch completion counts and the batch-scoped run list, read off real rows.
 *
 * @see specs/features/simulation-runs-batch-completion.feature
 * @see specs/features/simulation-runs-batch-filter.feature
 */

import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SimulationClickHouseRepository } from "../simulation-clickhouse.repository";
import { SimulationWindowedReadPort } from "../../../ports/simulation-windowed-read.port";

/** Derives the real [hint-window, hint+window] fragment from the hint the repository computes. */
class HintWindowedRead extends SimulationWindowedReadPort {
  async query<Result>(input: {
    hintMs: number | null;
    windowMs?: number;
    run: (
      window: {
        fromMs: number;
        toMs: number;
        params: { fromMs: number; toMs: number };
        sqlFor: (column: string) => string;
      } | null,
    ) => Promise<Result>;
  }): Promise<Result> {
    if (input.hintMs === null || input.windowMs === undefined) return input.run(null);
    const fromMs = input.hintMs - input.windowMs;
    const toMs = input.hintMs + input.windowMs;
    return input.run({
      fromMs,
      toMs,
      params: { fromMs, toMs },
      sqlFor: (column) => `AND ${column} >= {fromMs:Int64} AND ${column} <= {toMs:Int64}`,
    });
  }
}

const configuredClickHouseUrl = process.env.TEST_CLICKHOUSE_URL ?? process.env.CI_CLICKHOUSE_URL;
const databaseUrl = configuredClickHouseUrl ? new URL(configuredClickHouseUrl) : null;
if (databaseUrl && !process.env.TEST_CLICKHOUSE_URL) {
  databaseUrl.pathname = "/test_langwatch";
}

const tenantId = `test-batch-completion-${nanoid()}`;
const now = Date.now();

function makeRunRow({
  scenarioSetId,
  batchRunId,
  status = "SUCCESS",
  scenarioRunId = `run-${nanoid()}`,
  startedAt = new Date(now - 5000),
}: {
  scenarioSetId: string;
  batchRunId: string;
  status?: string;
  scenarioRunId?: string;
  startedAt?: Date;
}) {
  return {
    ProjectionId: `proj-${nanoid()}`,
    TenantId: tenantId,
    ScenarioRunId: scenarioRunId,
    ScenarioId: `scenario-${nanoid()}`,
    BatchRunId: batchRunId,
    ScenarioSetId: scenarioSetId,
    Version: "v1",
    Status: status,
    Name: "Refund Flow",
    Description: null,
    Metadata: null,
    "Messages.Id": [],
    "Messages.Role": [],
    "Messages.Content": [],
    "Messages.TraceId": [],
    "Messages.Rest": [],
    TraceIds: [],
    Verdict: "success",
    Reasoning: null,
    MetCriteria: [],
    UnmetCriteria: [],
    Error: null,
    DurationMs: "1500",
    StartedAt: startedAt,
    CreatedAt: startedAt,
    UpdatedAt: new Date(startedAt.getTime() + 1000),
    FinishedAt: new Date(startedAt.getTime() + 1000),
    ArchivedAt: null,
    LastSnapshotOccurredAt: new Date(0),
  };
}

let client: ClickHouseClient | undefined;
let repo: SimulationClickHouseRepository;

async function insertRows(rows: ReturnType<typeof makeRunRow>[]) {
  if (!client) throw new Error("ClickHouse integration environment is unavailable");
  await client.insert({
    table: "simulation_runs",
    values: rows,
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
}

const integration = describe.skipIf(databaseUrl === null);

beforeAll(() => {
  if (!databaseUrl) return;
  client = createClient({
    url: databaseUrl,
    clickhouse_settings: { date_time_input_format: "best_effort" },
  });
  repo = SimulationClickHouseRepository.create(async () => client!, new HintWindowedRead());
});

afterAll(async () => {
  if (!client) return;
  await client.exec({
    query: `ALTER TABLE simulation_runs DELETE WHERE TenantId = {tenantId:String}`,
    query_params: { tenantId },
  });
  await client.close();
  client = undefined;
});

async function seedBatch(statuses: string[]) {
  const scenarioSetId = `set-${nanoid()}`;
  const batchRunId = `batch-${nanoid()}`;
  await insertRows(statuses.map((status) => makeRunRow({ scenarioSetId, batchRunId, status })));
  return { scenarioSetId, batchRunId };
}

integration("the completion of a batch", () => {
  describe("given the batch still holds a queued run", () => {
    describe("when the batch aggregate is read", () => {
      /** @scenario "A batch with queued runs is not complete" */
      it("counts the queued run as running and the finished one as settled", async () => {
        const { batchRunId } = await seedBatch(["SUCCESS", "QUEUED"]);

        const summary = await repo.tryGetBatchSummary({ projectId: tenantId, batchRunId });

        expect(summary?.totalCount).toBe(2);
        expect(summary?.runningCount).toBe(1);
        expect(summary?.settledCount).toBe(1);
      });

      /** @scenario "allCompletedAt stays null until the last run settles" */
      it("leaves allCompletedAt null while the queued run waits", async () => {
        const { batchRunId } = await seedBatch(["SUCCESS", "QUEUED"]);

        const summary = await repo.tryGetBatchSummary({ projectId: tenantId, batchRunId });

        expect(summary?.allCompletedAt).toBeNull();
      });
    });
  });

  describe("given every run of the batch reached a terminal status", () => {
    describe("when the batch aggregate is read", () => {
      /** @scenario "A batch is complete when every run is terminal" */
      it("settles every run and carries a completion timestamp", async () => {
        const { batchRunId } = await seedBatch(["SUCCESS", "FAILURE"]);

        const summary = await repo.tryGetBatchSummary({ projectId: tenantId, batchRunId });

        expect(summary?.runningCount).toBe(0);
        expect(summary?.settledCount).toBe(summary?.totalCount);
        expect(summary?.allCompletedAt).not.toBeNull();
      });
    });
  });
});

integration("the batch-scoped run list", () => {
  describe("given runs exist in two different batches", () => {
    describe("when the list is requested with only a batch run id", () => {
      /** @scenario "A batch id alone filters the list" */
      it("returns the batch's runs and no others", async () => {
        const scenarioSetId = `set-only-${nanoid()}`;
        const batchRunId = `batch-only-${nanoid()}`;
        const wantedRunId = `run-only-${nanoid()}`;

        await insertRows([
          makeRunRow({ scenarioSetId, batchRunId, scenarioRunId: wantedRunId }),
          makeRunRow({ scenarioSetId, batchRunId: `batch-other-${nanoid()}` }),
        ]);

        const result = await repo.getRunDataForBatchRun({ projectId: tenantId, batchRunId });

        expect(result.changed).toBe(true);
        if (!result.changed) throw new Error("expected changed");
        expect(result.runs.map((r) => r.scenarioRunId)).toEqual([wantedRunId]);
      });
    });

    describe("when the list is requested with both a batch run id and a scenario set id", () => {
      /** @scenario "A batch id with a scenario set id keeps working" */
      it("returns the batch's runs", async () => {
        const scenarioSetId = `set-both-${nanoid()}`;
        const batchRunId = `batch-both-${nanoid()}`;
        const wantedRunId = `run-both-${nanoid()}`;

        await insertRows([
          makeRunRow({ scenarioSetId, batchRunId, scenarioRunId: wantedRunId }),
          makeRunRow({
            scenarioSetId: `set-elsewhere-${nanoid()}`,
            batchRunId: `batch-elsewhere-${nanoid()}`,
          }),
        ]);

        const result = await repo.getRunDataForBatchRun({
          projectId: tenantId,
          scenarioSetId,
          batchRunId,
        });

        expect(result.changed).toBe(true);
        if (!result.changed) throw new Error("expected changed");
        expect(result.runs.map((r) => r.scenarioRunId)).toEqual([wantedRunId]);
      });
    });
  });

  describe("given a batch holds one run in the default set and one in a named set", () => {
    describe("when the runs are read with the batch id and an empty scenario set id", () => {
      /** @scenario "An empty scenario set id still selects the default set" */
      it("keeps the default set filter instead of dropping it", async () => {
        const batchRunId = `batch-default-${nanoid()}`;
        // The default set holds both storage values: "" from rows written
        // before the set id got its name, and "default" from rows after.
        const legacyDefaultRunId = `run-legacy-default-${nanoid()}`;
        const namedDefaultRunId = `run-named-default-${nanoid()}`;

        await insertRows([
          makeRunRow({ scenarioSetId: "", batchRunId, scenarioRunId: legacyDefaultRunId }),
          makeRunRow({
            scenarioSetId: "default",
            batchRunId,
            scenarioRunId: namedDefaultRunId,
          }),
          makeRunRow({ scenarioSetId: `set-named-${nanoid()}`, batchRunId }),
        ]);

        const result = await repo.getRunDataForBatchRun({
          projectId: tenantId,
          scenarioSetId: "",
          batchRunId,
        });

        expect(result.changed).toBe(true);
        if (!result.changed) throw new Error("expected changed");
        // The two default rows share a CreatedAt, so their order is not
        // decided; only membership is.
        expect(result.runs.map((r) => r.scenarioRunId).sort()).toEqual(
          [legacyDefaultRunId, namedDefaultRunId].sort(),
        );
      });
    });
  });
});
