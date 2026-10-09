/**
 * @vitest-environment node
 *
 * @see specs/experiments-v3/run-board-snapshot.feature
 *
 * A run that carries the board in holds two columns at once: the one it ran and
 * the one it copied. Both are scored by the same evaluator on the same row, and
 * those are two different facts.
 *
 * `event_log` and `experiment_run_items` are both ReplacingMergeTree, so two
 * rows sharing an identity become one row. While the verdict's identity left
 * the target out, the second column's score was dropped on the way to storage
 * and the results page drew that column with its output and its cost but no
 * score. Carrying the board in is what makes a run with two columns the normal
 * case, so this walks the whole chain: the command's identity, the stored row,
 * the dedup key the read query groups on, and what comes back out.
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  startTestContainers,
  stopTestContainers,
} from "../../../event-sourcing/__tests__/integration/testContainers";

let testClient: ClickHouseClient;
vi.mock("~/server/clickhouse/clickhouseClient", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("~/server/clickhouse/clickhouseClient")
    >();
  return {
    ...actual,
    getClickHouseClientForTenant: async () => testClient,
  };
});

vi.mock("~/server/app-layer/app", async () => {
  const clients = await import("~/server/clickhouse/clickhouseClient");
  const app = () => ({
    clickhouse: {
      enabled: true,
      resolveClient: (tenantId: string) =>
        clients.getClickHouseClientForTenant(tenantId),
      resolveOrganizationClient: async () => {
        throw new Error("no organization client in this suite");
      },
      allInstances: async () => [],
    },
  });
  return { getApp: app, tryGetApp: app };
});

const { ExperimentRunService } = await import("../experiment-run.service");
const { RecordEvaluatorResultCommand, RecordTargetResultCommand } =
  await import(
    "../../../event-sourcing/pipelines/experiment-run-processing/commands"
  );
const { ExperimentRunResultStorageMapProjection } = await import(
  "../../../event-sourcing/pipelines/experiment-run-processing/projections/experimentRunResultStorage.mapProjection"
);
const { createExperimentRunItemAppendStore } = await import(
  "../../../event-sourcing/pipelines/experiment-run-processing/projections/experimentRunResultStorage.store"
);

const tenantId = `test-run-snapshot-${nanoid()}`;
const experimentId = `experiment-${nanoid()}`;
const runId = "bold-jolly-bee";

const CARRIED = "target-carried";
const RAN = "target-ran";
const EVALUATOR = "category_l3_exact";

/**
 * Puts one recorded result through the real chain: the command that gives it
 * its identity, the map projection that shapes the row, and the append store
 * that writes it.
 */
const record = async ({
  command,
  data,
}: {
  command: { handle: (payload: unknown) => unknown[] };
  data: Record<string, unknown>;
}): Promise<string> => {
  const [event] = command.handle({
    tenantId,
    data: { ...data, tenantId, occurredAt: Date.now() },
  }) as Array<{ idempotencyKey: string } & Record<string, unknown>>;
  if (!event) throw new Error("the command produced no event");

  const projection = new ExperimentRunResultStorageMapProjection({
    store: createExperimentRunItemAppendStore(async () => testClient),
  });
  const row =
    (data as { evaluatorId?: string }).evaluatorId === undefined
      ? projection.mapExperimentRunTargetResult(event as never)
      : projection.mapExperimentRunEvaluatorResult(event as never);

  await projection.store.append(row, {
    aggregateId: `${experimentId}:${runId}`,
    tenantId: tenantId as never,
  });

  return event.idempotencyKey;
};

beforeAll(async () => {
  const containers = await startTestContainers();
  testClient = containers.clickHouseClient;

  await testClient.command({
    query: `
      INSERT INTO experiment_runs
        (ProjectionId, TenantId, RunId, ExperimentId, Version, Total, Progress, Targets, CreatedAt, UpdatedAt, StartedAt)
      VALUES
        ({pid:String}, {tenant:String}, {runId:String}, {experimentId:String}, 'v1', 2, 2, {targets:String}, now64(3), now64(3), now64(3))
    `,
    query_params: {
      pid: nanoid(),
      tenant: tenantId,
      runId,
      experimentId,
      // A run declares the whole board, which is what makes the carried column
      // a column the results page is expected to draw.
      targets: JSON.stringify([
        { id: CARRIED, name: "Baseline", type: "prompt" },
        { id: RAN, name: "Candidate", type: "prompt" },
      ]),
    },
  });

  // The column the run carried in from the board: its output was produced by an
  // earlier run, so the money and the time stay on the row and the run's own
  // totals leave them out.
  await record({
    command: new RecordTargetResultCommand() as never,
    data: {
      runId,
      experimentId,
      index: 0,
      targetId: CARRIED,
      entry: { question: "one" },
      predicted: { output: "the baseline answer" },
      cost: 0.5,
      duration: 500,
      carriedOver: true,
    },
  });
  await record({
    command: new RecordEvaluatorResultCommand() as never,
    data: {
      runId,
      experimentId,
      index: 0,
      targetId: CARRIED,
      evaluatorId: EVALUATOR,
      evaluatorName: "Category exact",
      status: "processed",
      score: 1,
      passed: true,
      carriedOver: true,
    },
  });

  // The column the run actually ran.
  await record({
    command: new RecordTargetResultCommand() as never,
    data: {
      runId,
      experimentId,
      index: 0,
      targetId: RAN,
      entry: { question: "one" },
      predicted: { output: "the candidate answer" },
      cost: 0.25,
      duration: 250,
    },
  });
  await record({
    command: new RecordEvaluatorResultCommand() as never,
    data: {
      runId,
      experimentId,
      index: 0,
      targetId: RAN,
      evaluatorId: EVALUATOR,
      evaluatorName: "Category exact",
      status: "processed",
      score: 0,
      passed: false,
    },
  });
}, 180_000);

afterAll(async () => {
  await testClient
    ?.command({
      query: "DELETE FROM experiment_run_items WHERE TenantId = {t:String}",
      query_params: { t: tenantId },
    })
    .catch(() => undefined);
  await testClient
    ?.command({
      query: "DELETE FROM experiment_runs WHERE TenantId = {t:String}",
      query_params: { t: tenantId },
    })
    .catch(() => undefined);
  await stopTestContainers();
});

describe("given a run that carries one column and runs another", () => {
  describe("when both columns are scored by the same evaluator on the same row", () => {
    /** @scenario "A snapshot run keeps both columns' verdicts" */
    it("reads both columns' verdicts back from the run", async () => {
      const run = await ExperimentRunService.create(null as never).getRun({
        projectId: tenantId,
        experimentId,
        runId,
      });

      const verdicts = run?.evaluations.filter(
        (evaluation) => evaluation.evaluator === EVALUATOR,
      );

      expect(verdicts?.map((verdict) => verdict.targetId).sort()).toEqual([
        CARRIED,
        RAN,
      ]);
    });

    /** @scenario "A snapshot run keeps both columns' verdicts" */
    it("keeps each column's own score", async () => {
      const run = await ExperimentRunService.create(null as never).getRun({
        projectId: tenantId,
        experimentId,
        runId,
      });

      const scoreFor = (targetId: string) =>
        run?.evaluations.find(
          (evaluation) =>
            evaluation.evaluator === EVALUATOR &&
            evaluation.targetId === targetId,
        );

      expect(scoreFor(CARRIED)).toMatchObject({ score: 1, passed: true });
      expect(scoreFor(RAN)).toMatchObject({ score: 0, passed: false });
    });

    /** @scenario "A snapshot run keeps both columns' verdicts" */
    it("stores them as two rows, which a merge cannot collapse into one", async () => {
      // `experiment_run_items` is a ReplacingMergeTree ordered by ProjectionId,
      // so two verdicts sharing an identity become one row and one column loses
      // its score. FINAL forces the merge the read path would eventually see.
      const rows = await (
        await testClient.query({
          query: `
            SELECT TargetId, Score, CarriedOver
            FROM experiment_run_items FINAL
            WHERE TenantId = {t:String}
              AND RunId = {r:String}
              AND ResultType = 'evaluator'
            ORDER BY TargetId
          `,
          query_params: { t: tenantId, r: runId },
          format: "JSONEachRow",
        })
      ).json<{ TargetId: string; Score: number; CarriedOver: number }>();

      expect(rows).toEqual([
        { TargetId: CARRIED, Score: 1, CarriedOver: 1 },
        { TargetId: RAN, Score: 0, CarriedOver: 0 },
      ]);
    });

    /** @scenario "A snapshot run keeps both columns' verdicts" */
    it("holds a dataset row for the carried column, so it is not drawn empty", async () => {
      // The results page renders only the targets a run holds data for. This is
      // the whole point of carrying the board in: before it, the run declared
      // this column and held nothing for it.
      const run = await ExperimentRunService.create(null as never).getRun({
        projectId: tenantId,
        experimentId,
        runId,
      });

      expect(run?.dataset.map((entry) => entry.targetId).sort()).toEqual([
        CARRIED,
        RAN,
      ]);
    });
  });
});

describe("given a run whose items include carried rows and rows it produced", () => {
  const summaryOfTheRun = async () => {
    const { runs } = await ExperimentRunService.create(
      null as never,
    ).listRunsForExperimentPaginated({
      projectId: tenantId,
      experimentId,
      page: 1,
      pageSize: 10,
    });
    return runs.find((run) => run.runId === runId)?.summary;
  };

  describe("when the run's cost and duration summary is read", () => {
    /** @scenario "The run's cost summary leaves carried rows out" */
    it("counts only the rows the run produced", async () => {
      const summary = await summaryOfTheRun();

      // 0.25 from the column the run ran. The carried column's 0.5 was paid
      // for by the run that produced it, and the same goes for its 500ms.
      expect(summary?.datasetCost).toBeCloseTo(0.25, 6);
      expect(summary?.datasetAverageDuration).toBeCloseTo(250, 6);
    });
  });

  describe("when the run's per-evaluator breakdown is read", () => {
    /** @scenario "The run's evaluator breakdown keeps carried rows" */
    it("counts the carried verdict, so the pass rate covers the board", async () => {
      const summary = await summaryOfTheRun();

      // One of the two verdicts passed: the carried one.
      expect(summary?.evaluations[EVALUATOR]?.averagePassed).toBeCloseTo(
        0.5,
        6,
      );
      expect(summary?.evaluations[EVALUATOR]?.averageScore).toBeCloseTo(0.5, 6);
    });
  });
});
