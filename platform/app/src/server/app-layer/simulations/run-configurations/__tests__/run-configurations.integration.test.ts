/**
 * The configuration read has to survive the whole recording path, not the
 * query alone: the run dialog dispatches a queue command per scheduled run,
 * the command handler turns it into an event, the fold projection turns the
 * event's metadata into a stored column, and only then is there anything to
 * group. A break in any of those hops looks the same from the outside, a
 * dropdown that lists nothing, so every test here starts at `startRun` and
 * ends at a real ClickHouse read.
 *
 * Postgres is the one boundary that is stubbed. The plan rows contribute a
 * name and a scope and nothing else, and what is new here is the fold over the
 * runs.
 *
 * @see specs/features/agent-testing/run-configuration-history.feature
 */

import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "~/generated/prisma/client";
import { createResilientClickHouseClient } from "~/server/clickhouse/managedClient";
import {
  startTestContainers,
  stopTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";
import { createTenantId } from "~/server/event-sourcing/domain/tenantId";
import { QueueRunCommand } from "~/server/event-sourcing/pipelines/simulation-processing/commands";
import {
  type SimulationRunStateData,
  SimulationRunStateFoldProjection,
} from "~/server/event-sourcing/pipelines/simulation-processing/projections/simulationRunState.foldProjection";
import { SimulationRunStateRepositoryClickHouse } from "~/server/event-sourcing/pipelines/simulation-processing/repositories/simulationRunState.clickhouse.repository";
import type { QueueRunCommandData } from "~/server/event-sourcing/pipelines/simulation-processing/schemas/commands";
import type { FoldProjectionStore } from "~/server/event-sourcing/projections/foldProjection.types";
import type { RunParameterValues } from "~/server/scenarios/parameters";
import { getSuiteSetId } from "~/server/suites/suite-set-id";
import { NullSuiteRunReadRepository } from "../../../suites/repositories/suite-run.repository";
import {
  SuiteRunService,
  type SuiteRunTarget,
} from "../../../suites/suite-run.service";
import { RunConfigurationsClickHouseRepository } from "../run-configurations.clickhouse.repository";
import { RunConfigurationsService } from "../run-configurations.service";

const tenantId = `test-run-configs-${nanoid()}`;

/** The clock every run in this file is placed against. */
const NOW = Date.now();
const HOUR_MS = 60 * 60 * 1000;
const WINDOW_START = NOW - 7 * 24 * HOUR_MS;

const DEFAULT_TARGET: SuiteRunTarget = { type: "http", referenceId: "agent-1" };

const noopStore: FoldProjectionStore<SimulationRunStateData> = {
  store: async () => {},
  get: async () => null,
};

let ch: ClickHouseClient;
let repository: RunConfigurationsClickHouseRepository;
let stateRepository: SimulationRunStateRepositoryClickHouse<{
  id: string;
  aggregateId: string;
  tenantId: ReturnType<typeof createTenantId>;
  version: string;
  data: SimulationRunStateData;
}>;

beforeAll(async () => {
  const containers = await startTestContainers();
  ch = containers.clickHouseClient;
  const resilient = createResilientClickHouseClient({ client: ch });
  repository = new RunConfigurationsClickHouseRepository(async () => resilient);
  stateRepository = new SimulationRunStateRepositoryClickHouse(
    async () => resilient,
  );
}, 60_000);

afterAll(async () => {
  if (ch) {
    await ch.exec({
      query: `ALTER TABLE simulation_runs DELETE WHERE TenantId = {tenantId:String}`,
      query_params: { tenantId },
    });
  }
  await stopTestContainers();
});

/** A plan row, as the read reads one. Only the columns the read selects. */
interface StubPlan {
  id: string;
  name: string;
  kind: string;
  scope: unknown;
  scenarioIds: string[];
  targets: unknown;
}

/** A plan with every column the read needs, defaults filled in. */
function plan(overrides: Partial<StubPlan> & { id: string }): StubPlan {
  return {
    name: "Refund flow",
    kind: "run_plan",
    scope: { mode: "all" },
    scenarioIds: [],
    targets: [DEFAULT_TARGET],
    ...overrides,
  };
}

/** Postgres, answering with exactly the plans a test declared. */
function prismaWith(plans: StubPlan[]): PrismaClient {
  return {
    simulationSuite: { findMany: async () => plans },
  } as unknown as PrismaClient;
}

/**
 * Starts one batch and records every run of it at a chosen moment.
 *
 * Through the real service and the real command handler, not a hand-built
 * event: the metadata this read groups on is written by `startRun` and carried
 * by `QueueRunCommand`, so copying the fields here would keep the tests green
 * on the day either of them stopped carrying one.
 */
async function runBatch(params: {
  suiteId: string;
  scenarioIds: string[];
  targets?: SuiteRunTarget[];
  repeatCount?: number;
  parametersByScenarioId?: Map<string, RunParameterValues>;
  note?: string;
  simulatorModel?: string | null;
  judgeModel?: string | null;
  /** When the runs of this batch started, epoch ms. */
  runAt: number;
}): Promise<void> {
  const queued: QueueRunCommandData[] = [];
  const service = new SuiteRunService(new NullSuiteRunReadRepository(), {
    startSuiteRun: async () => {},
    queueSimulationRun: async (data) => {
      queued.push(data);
    },
  });

  await service.startRun({
    suiteId: params.suiteId,
    projectId: tenantId,
    activeScenarioIds: params.scenarioIds,
    scenarioNameMap: new Map(
      params.scenarioIds.map((id) => [id, `Scenario ${id}`]),
    ),
    scenarioVersionMap: new Map(params.scenarioIds.map((id) => [id, 1])),
    activeTargets: params.targets ?? [DEFAULT_TARGET],
    repeatCount: params.repeatCount ?? 1,
    skippedArchived: { scenarios: [], targets: [] },
    idempotencyKey: `idem-${nanoid()}`,
    simulatorModel: params.simulatorModel ?? null,
    judgeModel: params.judgeModel ?? null,
    ...(params.note !== undefined ? { note: params.note } : {}),
    ...(params.parametersByScenarioId
      ? { parametersByScenarioId: params.parametersByScenarioId }
      : {}),
  });

  for (const command of queued) {
    await recordQueuedRun({ command, runAt: params.runAt });
  }

  // The projection store writes async and does not wait, so a read straight
  // after it would race the queue rather than the code under test.
  await ch.exec({ query: "SYSTEM FLUSH ASYNC INSERT QUEUE" });
}

/**
 * Folds one queued command into stored state, at a chosen start time.
 *
 * `StartedAt` is the only field pinned by hand. A queued run leaves it null
 * until its started event lands, and these tests need runs at known moments to
 * say anything about ordering or about a window.
 */
async function recordQueuedRun({
  command,
  runAt,
}: {
  command: QueueRunCommandData;
  runAt: number;
}): Promise<void> {
  const events = await new QueueRunCommand().handle({
    type: "lw.simulation_run.queue",
    tenantId,
    data: command,
  } as Parameters<InstanceType<typeof QueueRunCommand>["handle"]>[0]);
  const event = events[0];
  if (!event) throw new Error("QueueRunCommand produced no event");

  const foldProjection = new SimulationRunStateFoldProjection({
    store: noopStore,
  });
  const folded = foldProjection.apply(foldProjection.init(), event);

  await stateRepository.storeProjection(
    {
      id: `projection-${nanoid()}`,
      aggregateId: command.scenarioRunId,
      tenantId: createTenantId(tenantId),
      version: new Date().toISOString().slice(0, 10),
      data: { ...folded, StartedAt: runAt },
    },
    { tenantId: createTenantId(tenantId) },
  );
}

/** The read under test, over the plans a test declared. */
async function readConfigurations(plans: StubPlan[]) {
  const service = new RunConfigurationsService(repository, prismaWith(plans));
  return service.getEntries({ projectId: tenantId, startDate: WINDOW_START });
}

describe("Feature: the previous configurations of a scope", () => {
  describe("given one plan run twice with different parameters", () => {
    /** @scenario "One plan run with two parameter sets is two configurations" */
    it("lists both, under one plan name, with different keys", async () => {
      const suiteId = `suite-${nanoid()}`;
      const scenarioId = `scenario-${nanoid()}`;

      await runBatch({
        suiteId,
        scenarioIds: [scenarioId],
        parametersByScenarioId: new Map([
          [scenarioId, { region: "eu-central" }],
        ]),
        runAt: NOW - 2 * HOUR_MS,
      });
      await runBatch({
        suiteId,
        scenarioIds: [scenarioId],
        parametersByScenarioId: new Map([[scenarioId, { region: "us-east" }]]),
        runAt: NOW - HOUR_MS,
      });

      const entries = await readConfigurations([
        plan({ id: suiteId, name: "Refunds" }),
      ]);

      expect(entries).toHaveLength(2);
      expect(entries.map((entry) => entry.planName)).toEqual([
        "Refunds",
        "Refunds",
      ]);
      expect(entries[0]!.key).not.toBe(entries[1]!.key);
      expect(entries.map((entry) => entry.runParameters.region).sort()).toEqual(
        ["eu-central", "us-east"],
      );
    });
  });

  describe("given one configuration run three times", () => {
    /** @scenario "The same configuration run many times is one entry" */
    it("lists one entry, reading the newest of the three", async () => {
      const suiteId = `suite-${nanoid()}`;
      const scenarioId = `scenario-${nanoid()}`;
      const newest = NOW - HOUR_MS;

      for (const runAt of [NOW - 5 * HOUR_MS, NOW - 3 * HOUR_MS, newest]) {
        await runBatch({ suiteId, scenarioIds: [scenarioId], runAt });
      }

      const entries = await readConfigurations([plan({ id: suiteId })]);

      expect(entries).toHaveLength(1);
      expect(entries[0]!.lastRunAt.getTime()).toBe(newest);
    });
  });

  describe("given a plan run with a repeat count of 3", () => {
    /** @scenario "The repeat count is counted from the runs of the batch" */
    it("counts it back off the runs of the batch", async () => {
      const suiteId = `suite-${nanoid()}`;

      await runBatch({
        suiteId,
        scenarioIds: [`scenario-${nanoid()}`, `scenario-${nanoid()}`],
        repeatCount: 3,
        runAt: NOW - HOUR_MS,
      });

      const entries = await readConfigurations([plan({ id: suiteId })]);

      expect(entries).toHaveLength(1);
      expect(entries[0]!.configuration.repeatCount).toBe(3);
    });
  });

  describe("given an older configuration and a newer one", () => {
    /** @scenario "Configurations are listed newest first" */
    it("lists the newer one first", async () => {
      const suiteId = `suite-${nanoid()}`;
      const scenarioId = `scenario-${nanoid()}`;

      await runBatch({
        suiteId,
        scenarioIds: [scenarioId],
        repeatCount: 1,
        runAt: NOW - 6 * HOUR_MS,
      });
      await runBatch({
        suiteId,
        scenarioIds: [scenarioId],
        repeatCount: 2,
        runAt: NOW - HOUR_MS,
      });

      const entries = await readConfigurations([plan({ id: suiteId })]);

      expect(entries.map((entry) => entry.configuration.repeatCount)).toEqual([
        2, 1,
      ]);
    });
  });

  describe("given two runs of one plan that differ only by their note", () => {
    /** @scenario "The note text is never part of a configuration" */
    it("lists one configuration and carries no note text on it", async () => {
      const suiteId = `suite-${nanoid()}`;
      const scenarioId = `scenario-${nanoid()}`;

      await runBatch({
        suiteId,
        scenarioIds: [scenarioId],
        note: "before the refactor",
        runAt: NOW - 3 * HOUR_MS,
      });
      await runBatch({
        suiteId,
        scenarioIds: [scenarioId],
        note: "after the refactor",
        runAt: NOW - HOUR_MS,
      });

      const entries = await readConfigurations([plan({ id: suiteId })]);

      expect(entries).toHaveLength(1);
      const served = JSON.stringify(entries);
      expect(served).not.toContain("before the refactor");
      expect(served).not.toContain("after the refactor");
    });
  });

  describe("given a plan whose runs carried a note", () => {
    /** @scenario "A configuration remembers that it takes a note" */
    it("says a note was used, and says so on a run that skipped one", async () => {
      const suiteId = `suite-${nanoid()}`;
      const scenarioId = `scenario-${nanoid()}`;

      await runBatch({
        suiteId,
        scenarioIds: [scenarioId],
        note: "checking the stricter judge",
        runAt: NOW - 3 * HOUR_MS,
      });
      // The newest run skipped the note. The plan still takes one.
      await runBatch({
        suiteId,
        scenarioIds: [scenarioId],
        runAt: NOW - HOUR_MS,
      });

      const entries = await readConfigurations([plan({ id: suiteId })]);

      expect(entries).toHaveLength(1);
      expect(entries[0]?.usesNote).toBe(true);
    });
  });

  describe("given a plan whose runs carried no note", () => {
    /** @scenario "A configuration that never took a note says so" */
    it("says no note was used", async () => {
      const suiteId = `suite-${nanoid()}`;

      await runBatch({
        suiteId,
        scenarioIds: [`scenario-${nanoid()}`],
        runAt: NOW - HOUR_MS,
      });

      const entries = await readConfigurations([plan({ id: suiteId })]);

      expect(entries).toHaveLength(1);
      expect(entries[0]?.usesNote).toBe(false);
    });
  });

  describe("given a plan that never ran", () => {
    /** @scenario "A scope that never ran lists nothing" */
    it("lists nothing", async () => {
      const entries = await readConfigurations([
        plan({ id: `suite-${nanoid()}` }),
      ]);

      expect(entries).toEqual([]);
    });
  });

  describe("given a run that names neither simulation model", () => {
    /** @scenario "A run recorded before the models were stamped keys as naming no model" */
    it("reads back as naming no model", async () => {
      const suiteId = `suite-${nanoid()}`;

      await runBatch({
        suiteId,
        scenarioIds: [`scenario-${nanoid()}`],
        runAt: NOW - HOUR_MS,
      });

      const entries = await readConfigurations([plan({ id: suiteId })]);

      expect(entries[0]!.configuration.simulatorModel).toBeNull();
      expect(entries[0]!.configuration.judgeModel).toBeNull();
    });
  });

  describe("given a plan run with both simulation models", () => {
    /** @scenario "The read carries the models the plan was configured with" */
    it("carries both back", async () => {
      const suiteId = `suite-${nanoid()}`;

      await runBatch({
        suiteId,
        scenarioIds: [`scenario-${nanoid()}`],
        simulatorModel: "openai/gpt-5-mini",
        judgeModel: "openai/gpt-5",
        runAt: NOW - HOUR_MS,
      });

      const entries = await readConfigurations([plan({ id: suiteId })]);

      expect(entries[0]!.configuration.simulatorModel).toBe(
        "openai/gpt-5-mini",
      );
      expect(entries[0]!.configuration.judgeModel).toBe("openai/gpt-5");
    });
  });

  describe("given a batch whose scenarios resolved different parameter values", () => {
    /** @scenario "Two scenarios of one batch that resolved different parameters take the first scenario's" */
    it("takes the first scenario's values", async () => {
      const suiteId = `suite-${nanoid()}`;
      const first = `scenario-a-${nanoid()}`;
      const second = `scenario-b-${nanoid()}`;

      await runBatch({
        suiteId,
        scenarioIds: [first, second],
        parametersByScenarioId: new Map([
          [first, { region: "eu-central" }],
          [second, { region: "us-east" }],
        ]),
        runAt: NOW - HOUR_MS,
      });

      const entries = await readConfigurations([plan({ id: suiteId })]);

      expect(entries).toHaveLength(1);
      expect(entries[0]!.runParameters).toEqual({ region: "eu-central" });
    });
  });

  describe("given a plan whose runs went to two targets", () => {
    it("reads one configuration naming both, in a stable order", async () => {
      const suiteId = `suite-${nanoid()}`;
      const targets: SuiteRunTarget[] = [
        { type: "http", referenceId: "prod-agent" },
        { type: "http", referenceId: "dev-agent" },
      ];

      await runBatch({
        suiteId,
        scenarioIds: [`scenario-${nanoid()}`],
        targets,
        runAt: NOW - HOUR_MS,
      });

      const entries = await readConfigurations([
        plan({ id: suiteId, targets }),
      ]);

      expect(entries).toHaveLength(1);
      expect(
        entries[0]!.configuration.targets.map((target) => target.referenceId),
      ).toEqual(["dev-agent", "prod-agent"]);
    });
  });

  describe("given a run of a plan that is not in the read", () => {
    it("lists nothing for it, because its set id is not asked for", async () => {
      const suiteId = `suite-${nanoid()}`;
      await runBatch({
        suiteId,
        scenarioIds: [`scenario-${nanoid()}`],
        runAt: NOW - HOUR_MS,
      });

      const rows = await repository.findConfigurations({
        filter: {
          projectId: tenantId,
          startDate: WINDOW_START,
          scenarioSetIds: [getSuiteSetId(`suite-${nanoid()}`)],
        },
      });

      expect(rows).toEqual([]);
    });
  });
});
