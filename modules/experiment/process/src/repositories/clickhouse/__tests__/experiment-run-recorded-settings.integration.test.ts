/**
 * A run's concurrency, repeat and its targets' label versions survive the store and the read.
 * @see modules/experiment/specs/experiment-run-recorded-settings.feature
 * @see specs/experiments-v3/run-repeat.feature
 *
 * @integration
 * @vitest-environment node
 */
import { TupleParam, type ClickHouseClient } from "@clickhouse/client";
import { vendorQueryClient } from "@langwatch/clickhouse-client/testing";
import { createTenantId, type FoldProjectionStore } from "@langwatch/eventing";
import type { ExperimentRunPlan } from "@langwatch/experiment-contract";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  deleteMigratedTenantRows,
  startMigratedClickHouse,
} from "../../../__tests__/migrated-clickhouse.harness.ts";
import type { ExperimentRunStartedEvent } from "../../../eventing/experiment-run-events.process.ts";
import {
  type ExperimentRunStateData,
  ExperimentRunStateFoldProjection,
} from "../../../eventing/experiment-run-state.projection.ts";
import {
  EXPERIMENT_RUN_EVENT_TYPES,
  EXPERIMENT_RUN_EVENT_VERSIONS,
  EXPERIMENT_RUN_PROJECTION_VERSIONS,
} from "../../../rules/experiment-run-event-types.rules.ts";
import {
  ExperimentClickHouseRepository,
  type ExperimentEventingClickHouseClient,
} from "../../experiment-clickhouse.repository.ts";
import {
  EXPERIMENT_ID_INDEXES,
  EXPERIMENT_SECOND_ID_INDEXES,
} from "../clickhouse.experiment-id-indexes.database.ts";
import { ClickHouseExperimentRunStateRepository } from "../clickhouse.experiment-run-state.repository.ts";
import { ClickHouseExperimentRunRepository } from "../clickhouse.experiment-run.repository.ts";
import { ClickHouseExperimentSession } from "../clickhouse.experiment-session.store.ts";

const tenantId = `test-run-settings-${nanoid()}`;
const TENANT = createTenantId(tenantId);
const experimentId = `experiment-${nanoid()}`;

let client: ClickHouseClient;
let runs: ClickHouseExperimentRunRepository;
let states: ClickHouseExperimentRunStateRepository;

/** The one client every read and write in this suite resolves to. */
class SuiteClickHouse extends ExperimentClickHouseRepository {
  resolveClient(): Promise<ExperimentEventingClickHouseClient> {
    return Promise.resolve(client);
  }
}

const noStore: FoldProjectionStore<ExperimentRunStateData> = {
  store: async () => {},
  get: async () => ({ kind: "empty" as const }),
};
const fold = ExperimentRunStateFoldProjection.create({ store: noStore });

const plan = (concurrency: number, repeat?: number): ExperimentRunPlan => ({
  concurrency,
  ...(repeat !== undefined ? { repeat } : {}),
  origin: "saved",
  persistResults: false,
  scope: { type: "full" },
  mappingDatasetId: "dataset_1",
  targets: [],
  evaluators: [],
  datasetColumns: [],
  rows: [],
  cells: [],
  pinned: { prompts: [], workflows: [] },
});

/** Folds a run's start and stores it the way the run pipeline does. */
async function storeStartedRun({
  runId,
  concurrency,
  repeat,
}: {
  runId: string;
  concurrency?: number;
  repeat?: number;
}): Promise<void> {
  const event: ExperimentRunStartedEvent = {
    id: `event-${nanoid()}`,
    aggregateId: `${experimentId}:${runId}`,
    aggregateType: "experiment_run",
    tenantId: TENANT,
    createdAt: Date.now(),
    occurredAt: Date.now(),
    type: EXPERIMENT_RUN_EVENT_TYPES.STARTED,
    version: EXPERIMENT_RUN_EVENT_VERSIONS.STARTED,
    data: {
      runId,
      experimentId,
      total: 0,
      targets: [
        {
          id: "target-agent",
          name: "refund-bot",
          type: "agent",
          agentId: "agent-1",
          agentLabel: "production",
          agentVersion: 3,
        },
      ],
      ...(concurrency !== undefined ? { plan: plan(concurrency, repeat) } : {}),
    },
  };
  const data = fold.apply(fold.init(), event);
  await states.storeProjection(
    {
      id: event.id,
      aggregateId: event.aggregateId,
      tenantId: TENANT,
      version: EXPERIMENT_RUN_PROJECTION_VERSIONS.RUN_STATE,
      data,
    },
    { tenantId: TENANT },
  );
}

beforeAll(async () => {
  ({ client } = await startMigratedClickHouse());
  states = ClickHouseExperimentRunStateRepository.create({
    clickhouse: new SuiteClickHouse(),
    defaultRetentionDays: () => 90,
  });
  runs = ClickHouseExperimentRunRepository.create({
    workflowVersions: { findByIds: async () => ({}) },
    resolveClient: ClickHouseExperimentSession.resolverOver(
      vendorQueryClient({
        vendor: client,
        indexes: [...EXPERIMENT_ID_INDEXES, ...EXPERIMENT_SECOND_ID_INDEXES],
      }),
    ),
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
  await deleteMigratedTenantRows({ client, tenantId, tables: ["experiment_runs"] });
});

describe("given a run stored with concurrency 2 and a target pinned to production at v3", () => {
  describe("when the run and the experiment's run list are read", () => {
    /** @scenario "A stored run reads back its concurrency and its targets' label versions" */
    it("carries the concurrency and the label version on both reads", async () => {
      const runId = `run-${nanoid()}`;
      await storeStartedRun({ runId, concurrency: 2 });

      const run = await runs.findRun({ projectId: tenantId, experimentId, runId });
      const page = await runs.listPage({
        projectId: tenantId,
        experimentId,
        page: 1,
        pageSize: 20,
      });
      const listed = page.runs.find((entry) => entry.runId === runId);

      expect(run?.concurrency).toBe(2);
      expect(listed?.concurrency).toBe(2);
      for (const targets of [run?.targets, listed?.targets]) {
        expect(targets?.[0]).toMatchObject({ agentLabel: "production", agentVersion: 3 });
      }
    });
  });
});

describe("given a run stored with no concurrency", () => {
  describe("when the run is read", () => {
    /** @scenario "A run stored before runs recorded concurrency reads none" */
    it("reads its concurrency as null", async () => {
      const runId = `run-${nanoid()}`;
      await storeStartedRun({ runId });

      const run = await runs.findRun({ projectId: tenantId, experimentId, runId });

      expect(run?.runId).toBe(runId);
      expect(run?.concurrency).toBeNull();
    });
  });
});

describe("given a run stored with a repeat of 3", () => {
  describe("when the run and the experiment's run list are read", () => {
    /** @scenario "A stored repeated run reads back its repeat" */
    it("carries the repeat on both reads, and an unrepeated run reads null", async () => {
      const runId = `run-${nanoid()}`;
      const unrepeatedId = `run-${nanoid()}`;
      await storeStartedRun({ runId, concurrency: 2, repeat: 3 });
      await storeStartedRun({ runId: unrepeatedId, concurrency: 2 });

      const run = await runs.findRun({ projectId: tenantId, experimentId, runId });
      const unrepeated = await runs.findRun({
        projectId: tenantId,
        experimentId,
        runId: unrepeatedId,
      });
      const page = await runs.listPage({
        projectId: tenantId,
        experimentId,
        page: 1,
        pageSize: 20,
      });
      const listed = page.runs.find((entry) => entry.runId === runId);

      expect(run?.repeat).toBe(3);
      expect(listed?.repeat).toBe(3);
      expect(unrepeated?.repeat).toBeNull();
      expect(run?.targets?.[0]?.metadata ?? null).toBeNull();
    });
  });
});
