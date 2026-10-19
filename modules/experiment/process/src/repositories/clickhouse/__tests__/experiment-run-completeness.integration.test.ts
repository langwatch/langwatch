/**
 * A read of an SDK run says whether every result the run reported is stored yet.
 * @see modules/experiment/specs/experiment-run-results-completeness.feature
 *
 * @integration
 * @vitest-environment node
 */
import { TupleParam, type ClickHouseClient } from "@clickhouse/client";
import { createTenantId, type Event } from "@langwatch/eventing";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  deleteMigratedTenantRows,
  startMigratedClickHouse,
} from "../../../__tests__/migrated-clickhouse.harness.ts";
import {
  evaluatorResultEventSchema,
  targetResultEventSchema,
} from "../../../eventing/experiment-run-events.process.ts";
import { ExperimentRunItemStore } from "../../../eventing/experiment-run-item.store.ts";
import {
  RecordEvaluatorResultCommand,
  RecordTargetResultCommand,
} from "../../../eventing/experiment-run-processing.commands.ts";
import {
  type ClickHouseExperimentRunResultRecord,
  ExperimentRunResultStorageMapProjection,
} from "../../../eventing/experiment-run-result-storage.projection.ts";
import {
  ExperimentClickHouseRepository,
  type ExperimentEventingClickHouseClient,
} from "../../experiment-clickhouse.repository.ts";
import { ClickHouseExperimentRunRepository } from "../clickhouse.experiment-run.repository.ts";

const tenantId = `test-run-completeness-${nanoid()}`;
const TENANT = createTenantId(tenantId);
const experimentId = `experiment-${nanoid()}`;
const TARGET = "target-a";
const EVALUATORS = ["check-a", "check-b"];

let client: ClickHouseClient;
let repository: ClickHouseExperimentRunRepository;

/** The one client every read and write in this suite resolves to. */
class SuiteClickHouse extends ExperimentClickHouseRepository {
  resolveClient(): Promise<ExperimentEventingClickHouseClient> {
    return Promise.resolve(client);
  }
}

function storage(): ExperimentRunResultStorageMapProjection {
  return ExperimentRunResultStorageMapProjection.create({
    store: ExperimentRunItemStore.create({
      clickhouse: new SuiteClickHouse(),
      defaultRetentionDays: () => 90,
    }),
  });
}

function rowRecord({ runId, index }: { runId: string; index: number }) {
  const [produced] = new RecordTargetResultCommand().handle({
    tenantId: TENANT,
    aggregateId: `${experimentId}:${runId}`,
    type: "lw.experiment_run.record_target_result",
    data: {
      tenantId: TENANT,
      occurredAt: Date.now(),
      runId,
      experimentId,
      index,
      targetId: TARGET,
      entry: { question: `row ${index}` },
      predicted: { output: "an answer" },
    },
  }) as Event[];

  return storage().mapExperimentRunTargetResult(targetResultEventSchema.parse(produced));
}

function verdictRecord({
  runId,
  index,
  evaluatorId,
}: {
  runId: string;
  index: number;
  evaluatorId: string;
}) {
  const [produced] = new RecordEvaluatorResultCommand().handle({
    tenantId: TENANT,
    aggregateId: `${experimentId}:${runId}`,
    type: "lw.experiment_run.record_evaluator_result",
    data: {
      tenantId: TENANT,
      occurredAt: Date.now(),
      runId,
      experimentId,
      index,
      targetId: TARGET,
      evaluatorId,
      status: "processed",
      passed: true,
    },
  }) as Event[];

  return storage().mapExperimentRunEvaluatorResult(evaluatorResultEventSchema.parse(produced));
}

/** Every result a run of 2 rows and 2 evaluators reports: 2 rows, then 4 verdicts. */
function reportedResults(runId: string): ClickHouseExperimentRunResultRecord[] {
  const rows = [0, 1].map((index) => rowRecord({ runId, index }));
  const verdicts = [0, 1].flatMap((index) =>
    EVALUATORS.map((evaluatorId) => verdictRecord({ runId, index, evaluatorId })),
  );

  return [...rows, ...verdicts];
}

/** A finished run that reported 2 rows and 4 verdicts, holding the given part of them. */
async function seedFinishedRun({
  runId,
  stored,
  expected = { dataset: 2, evaluations: 4 },
}: {
  runId: string;
  stored: ClickHouseExperimentRunResultRecord[];
  expected?: { dataset: number; evaluations: number } | null;
}): Promise<void> {
  await client.command({
    query: `
      INSERT INTO experiment_runs
        (ProjectionId, TenantId, RunId, ExperimentId, Version, Total, Progress, Targets,
         CreatedAt, UpdatedAt, StartedAt, FinishedAt, ExpectedTargetResults, ExpectedEvaluatorResults)
      VALUES
        ({pid:String}, {tenant:String}, {runId:String}, {experimentId:String}, 'v1', 2, 2, {targets:String},
         now64(3), now64(3), now64(3), now64(3), {rows:Nullable(UInt32)}, {verdicts:Nullable(UInt32)})
    `,
    query_params: {
      pid: nanoid(),
      tenant: tenantId,
      runId,
      experimentId,
      targets: JSON.stringify([{ id: TARGET, name: "Candidate", type: "custom" }]),
      rows: expected?.dataset ?? null,
      verdicts: expected?.evaluations ?? null,
    },
  });
  await storage().store.bulkAppend?.(stored, { tenantId: TENANT });
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
}, 180_000);

afterAll(async () => {
  if (!client) return;
  await deleteMigratedTenantRows({
    client,
    tenantId,
    tables: ["experiment_runs", "experiment_run_items"],
  });
});

describe("given a finished run that reported 2 rows and 4 verdicts", () => {
  describe("when all of them are stored", () => {
    /** @scenario "A finished run with every reported result stored reads as complete" */
    it("reads as complete, counting 2 of 2 rows and 4 of 4 verdicts", async () => {
      const runId = "whole-run";
      await seedFinishedRun({ runId, stored: reportedResults(runId) });

      const run = await repository.findRun({ projectId: tenantId, experimentId, runId });

      expect(run?.completeness).toEqual({
        complete: true,
        dataset: { received: 2, expected: 2 },
        evaluations: { received: 4, expected: 4 },
      });
    });

    /** @scenario "A batch of results is readable after one bulk write" */
    it("reads back every result the one bulk write carried", async () => {
      const runId = "bulk-run";
      await seedFinishedRun({ runId, stored: reportedResults(runId) });

      const run = await repository.findRun({ projectId: tenantId, experimentId, runId });

      expect(run?.dataset.map((row) => row.index).toSorted()).toEqual([0, 1]);
      expect(
        run?.evaluations.map((verdict) => `${verdict.index}:${verdict.evaluator}`).toSorted(),
      ).toEqual(["0:check-a", "0:check-b", "1:check-a", "1:check-b"]);
    });
  });

  describe("when only 3 verdicts are stored", () => {
    /** @scenario "A finished run still missing verdicts reads as incomplete" */
    it("reads as not complete, counting 3 of 4 verdicts", async () => {
      const runId = "partial-run";
      await seedFinishedRun({ runId, stored: reportedResults(runId).slice(0, 5) });

      const run = await repository.findRun({ projectId: tenantId, experimentId, runId });

      expect(run?.completeness.complete).toBe(false);
      expect(run?.completeness.dataset).toEqual({ received: 2, expected: 2 });
      expect(run?.completeness.evaluations).toEqual({ received: 3, expected: 4 });
    });
  });
});

describe("given a finished run reported by an SDK that sends no counts", () => {
  describe("when its results are read", () => {
    it("reads as complete with unknown totals", async () => {
      const runId = "legacy-run";
      await seedFinishedRun({ runId, stored: reportedResults(runId), expected: null });

      const run = await repository.findRun({ projectId: tenantId, experimentId, runId });

      expect(run?.completeness).toEqual({
        complete: true,
        dataset: { received: 2, expected: null },
        evaluations: { received: 4, expected: null },
      });
    });
  });
});
