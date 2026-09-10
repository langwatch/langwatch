/**
 * A run that carries the board in holds two columns at once: the one it ran and
 * the one it copied. Both are scored by the same evaluator on the same row, and
 * those are two different facts.
 *
 * `experiment_run_items` is a ReplacingMergeTree, so two rows sharing an
 * identity become one row. While the verdict's identity left the target out,
 * the second column's score was dropped on the way to storage and the results
 * page drew that column with its output and its cost but no score. Carrying the
 * board in is what makes a run with two columns the normal case, so this walks
 * the whole chain: the command's identity, the stored row, the dedup key the
 * read query groups on, and what comes back out.
 *
 * @see specs/experiments-v3/run-board-snapshot.feature
 *
 * @integration
 * @vitest-environment node
 */
import { TupleParam, type ClickHouseClient } from "@clickhouse/client";
import { createTenantId, type Event } from "@langwatch/eventing";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  RecordEvaluatorResultCommand,
  RecordTargetResultCommand,
} from "../clickhouse.experiment-run-processing.repository.ts";
import {
  deleteMigratedTenantRows,
  startMigratedClickHouse,
} from "../../../__tests__/migrated-clickhouse.harness.ts";
import {
  evaluatorResultEventSchema,
  targetResultEventSchema,
  type EvaluatorResultEventData,
  type TargetResultEventData,
} from "../../../processes/experiment-run-events.process.ts";
import {
  ExperimentClickHousePort,
  type ExperimentEventingClickHouseClient,
} from "../../../ports/experiment-clickhouse.port.ts";
import { ExperimentRunResultStorageMapProjection } from "../../../projections/experiment-run-result-storage.projection.ts";
import { ExperimentRunItemStore } from "../../../stores/eventing/eventing.experiment-run-item.store.ts";
import { ClickHouseExperimentRunRepository } from "../clickhouse.experiment-run.repository.ts";

const tenantId = `test-run-snapshot-${nanoid()}`;
const TENANT = createTenantId(tenantId);
const experimentId = `experiment-${nanoid()}`;
const runId = "bold-jolly-bee";

const CARRIED = "target-carried";
const RAN = "target-ran";
const EVALUATOR = "category_l3_exact";

const SEEDED_TABLES = ["experiment_runs", "experiment_run_items"] as const;

let client: ClickHouseClient;
let repository: ClickHouseExperimentRunRepository;

/** The one client every read and write in this suite resolves to. */
class SuiteClickHouse extends ExperimentClickHousePort {
  resolveClient(): Promise<ExperimentEventingClickHouseClient> {
    return Promise.resolve(client);
  }
}

/** The projection and append store the recorded events are stored through. */
function storage(): ExperimentRunResultStorageMapProjection {
  return ExperimentRunResultStorageMapProjection.create({
    store: ExperimentRunItemStore.create({
      clickhouse: new SuiteClickHouse(),
      defaultRetentionDays: 90,
    }),
  });
}

const storeContext = () => ({
  aggregateId: `${experimentId}:${runId}`,
  tenantId: TENANT,
});

/**
 * Puts one recorded output through the real chain: the command that gives it
 * its identity, the map projection that shapes the row, and the append store
 * that writes it.
 */
async function recordOutput(data: TargetResultEventData): Promise<void> {
  const [produced] = new RecordTargetResultCommand().handle({
    tenantId: TENANT,
    aggregateId: `${experimentId}:${runId}`,
    type: "lw.experiment_run.record_target_result",
    data: { ...data, tenantId: TENANT, occurredAt: Date.now() },
  }) as Event[];
  if (!produced) throw new Error("the command produced no event");

  const projection = storage();
  await projection.store.append(
    projection.mapExperimentRunTargetResult(targetResultEventSchema.parse(produced)),
    storeContext(),
  );
}

/** The same chain for one recorded verdict. */
async function recordVerdict(data: EvaluatorResultEventData): Promise<void> {
  const [produced] = new RecordEvaluatorResultCommand().handle({
    tenantId: TENANT,
    aggregateId: `${experimentId}:${runId}`,
    type: "lw.experiment_run.record_evaluator_result",
    data: { ...data, tenantId: TENANT, occurredAt: Date.now() },
  }) as Event[];
  if (!produced) throw new Error("the command produced no event");

  const projection = storage();
  await projection.store.append(
    projection.mapExperimentRunEvaluatorResult(evaluatorResultEventSchema.parse(produced)),
    storeContext(),
  );
}

beforeAll(async () => {
  ({ client } = await startMigratedClickHouse());
  repository = ClickHouseExperimentRunRepository.create({
    workflowVersions: { findByIds: async () => ({}) },
    resolveClient: async () => client,
    tupleParam: (values: string[]) => new TupleParam(values),
    telemetry: {
      trace: async <T>(_input: unknown, operation: () => Promise<T>) => operation(),
      warnOldRuns: () => {},
      error: () => {},
      warn: () => {},
    },
  });

  await client.command({
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
  await recordOutput({
    runId,
    experimentId,
    index: 0,
    targetId: CARRIED,
    entry: { question: "one" },
    predicted: { output: "the baseline answer" },
    cost: 0.5,
    duration: 500,
    carriedOver: true,
  });
  await recordVerdict({
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
  });

  // The column the run actually ran.
  await recordOutput({
    runId,
    experimentId,
    index: 0,
    targetId: RAN,
    entry: { question: "one" },
    predicted: { output: "the candidate answer" },
    cost: 0.25,
    duration: 250,
  });
  await recordVerdict({
    runId,
    experimentId,
    index: 0,
    targetId: RAN,
    evaluatorId: EVALUATOR,
    evaluatorName: "Category exact",
    status: "processed",
    score: 0,
    passed: false,
  });
}, 180_000);

afterAll(async () => {
  if (!client) return;
  await deleteMigratedTenantRows({ client, tenantId, tables: SEEDED_TABLES });
});

describe("given a run that carries one column and runs another", () => {
  describe("when both columns are scored by the same evaluator on the same row", () => {
    /** @scenario A snapshot run keeps both columns' verdicts */
    it("reads both columns' verdicts back from the run", async () => {
      const run = await repository.findRun({ projectId: tenantId, experimentId, runId });

      const verdicts = run?.evaluations.filter((evaluation) => evaluation.evaluator === EVALUATOR);

      expect(verdicts?.map((verdict) => verdict.targetId).sort()).toEqual([CARRIED, RAN]);
    });

    /** @scenario A snapshot run keeps both columns' verdicts */
    it("keeps each column's own score", async () => {
      const run = await repository.findRun({ projectId: tenantId, experimentId, runId });

      const scoreFor = (targetId: string) =>
        run?.evaluations.find(
          (evaluation) => evaluation.evaluator === EVALUATOR && evaluation.targetId === targetId,
        );

      expect(scoreFor(CARRIED)).toMatchObject({ score: 1, passed: true });
      expect(scoreFor(RAN)).toMatchObject({ score: 0, passed: false });
    });

    /** @scenario A snapshot run keeps both columns' verdicts */
    it("stores them as two rows, which a merge cannot collapse into one", async () => {
      // `experiment_run_items` is a ReplacingMergeTree ordered by ProjectionId,
      // so two verdicts sharing an identity become one row and one column loses
      // its score. FINAL forces the merge the read path would eventually see.
      const rows = await (
        await client.query({
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

    /** @scenario A snapshot run keeps both columns' verdicts */
    it("holds a dataset row for the carried column, so it is not drawn empty", async () => {
      // The results page renders only the targets a run holds data for. This is
      // the whole point of carrying the board in: before it, the run declared
      // this column and held nothing for it.
      const run = await repository.findRun({ projectId: tenantId, experimentId, runId });

      expect(run?.dataset.map((entry) => entry.targetId).sort()).toEqual([CARRIED, RAN]);
    });
  });
});

describe("given a run whose items include carried rows and rows it produced", () => {
  const summaryOfTheRun = async () => {
    const { runs } = await repository.getPage({
      projectId: tenantId,
      experimentId,
      page: 1,
      pageSize: 10,
    });
    return runs.find((run) => run.runId === runId)?.summary;
  };

  describe("when the run's cost and duration summary is read", () => {
    /** @scenario The run's cost summary leaves carried rows out */
    it("counts only the rows the run produced", async () => {
      const summary = await summaryOfTheRun();

      // 0.25 from the column the run ran. The carried column's 0.5 was paid
      // for by the run that produced it, and the same goes for its 500ms.
      expect(summary?.datasetCost).toBeCloseTo(0.25, 6);
      expect(summary?.datasetAverageDuration).toBeCloseTo(250, 6);
    });
  });

  describe("when the run's per-evaluator breakdown is read", () => {
    /** @scenario The run's evaluator breakdown keeps carried rows */
    it("counts the carried verdict, so the pass rate covers the board", async () => {
      const summary = await summaryOfTheRun();

      // One of the two verdicts passed: the carried one.
      expect(summary?.evaluations[EVALUATOR]?.averagePassed).toBeCloseTo(0.5, 6);
      expect(summary?.evaluations[EVALUATOR]?.averageScore).toBeCloseTo(0.5, 6);
    });
  });
});
