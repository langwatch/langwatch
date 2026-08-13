/**
 * The parameter values a run resolved have to survive the whole recording
 * path, not just the call that starts the run: the queued command carries them
 * as metadata, the fold projection is what turns that metadata into a stored
 * column, and the read repository is what a run detail drawer actually reads.
 * Assert each hop in one place, against a real ClickHouse, because a break in
 * any of them looks identical from the outside: a run that started fine and
 * shows nothing.
 */

import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  startTestContainers,
  stopTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";
import { createTenantId } from "~/server/event-sourcing/domain/tenantId";
import {
  type SimulationRunStateData,
  SimulationRunStateFoldProjection,
} from "~/server/event-sourcing/pipelines/simulation-processing/projections/simulationRunState.foldProjection";
import { SimulationRunStateRepositoryClickHouse } from "~/server/event-sourcing/pipelines/simulation-processing/repositories/simulationRunState.clickhouse.repository";
import { QueueRunCommand } from "~/server/event-sourcing/pipelines/simulation-processing/commands";
import type { QueueRunCommandData } from "~/server/event-sourcing/pipelines/simulation-processing/schemas/commands";
import type { FoldProjectionStore } from "~/server/event-sourcing/projections/foldProjection.types";
import { createResilientClickHouseClient } from "../../clients/clickhouse";
import { SimulationClickHouseRepository } from "../../simulations/repositories/simulation.clickhouse.repository";
import { NullSuiteRunReadRepository } from "../repositories/suite-run.repository";
import { SuiteRunService } from "../suite-run.service";

const tenantId = `test-suite-params-${nanoid()}`;

const noopStore: FoldProjectionStore<SimulationRunStateData> = {
  store: async () => {},
  get: async () => null,
};

let ch: ClickHouseClient;
let readRepository: SimulationClickHouseRepository;
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
  readRepository = new SimulationClickHouseRepository(async () => resilient);
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

/** Starts a run and returns the queued command it dispatched for a scenario. */
async function queuedCommandFor(params: {
  scenarioId: string;
  parameters?: Record<string, string | number | boolean>;
}): Promise<QueueRunCommandData> {
  const queued: QueueRunCommandData[] = [];
  const service = new SuiteRunService(
    new NullSuiteRunReadRepository(),
    async () => {},
    async (data) => {
      queued.push(data);
    },
  );

  await service.startRun({
    suiteId: `suite-${nanoid()}`,
    projectId: tenantId,
    activeScenarioIds: [params.scenarioId],
    scenarioNameMap: new Map([[params.scenarioId, "Refund flow"]]),
    activeTargets: [{ type: "http", referenceId: "agent-1" }],
    repeatCount: 1,
    skippedArchived: { scenarios: [], targets: [] },
    idempotencyKey: `idem-${nanoid()}`,
    ...(params.parameters && {
      parametersByScenarioId: new Map([[params.scenarioId, params.parameters]]),
    }),
  });

  const command = queued[0];
  if (!command) throw new Error("startRun dispatched no queued command");
  return command;
}

/** Folds the queued command into stored state, the way the pipeline does. */
async function recordQueuedRun(command: QueueRunCommandData): Promise<void> {
  // Through the real command handler, not a hand-built event. The command data
  // and the event data share one schema, so copying the fields here by hand
  // would keep passing on the day the handler stopped carrying metadata, which
  // is exactly the hop this file exists to cover.
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
  const data = foldProjection.apply(foldProjection.init(), event);

  await stateRepository.storeProjection(
    {
      id: `projection-${nanoid()}`,
      aggregateId: command.scenarioRunId,
      tenantId: createTenantId(tenantId),
      version: new Date().toISOString().slice(0, 10),
      data,
    },
    { tenantId: createTenantId(tenantId) },
  );

  // The projection store writes async and does not wait, so a read straight
  // after it would race the queue rather than the code under test.
  await ch.exec({ query: "SYSTEM FLUSH ASYNC INSERT QUEUE" });
}

describe("Feature: recording a run's resolved parameters", () => {
  describe("given a run started with values for the scenario's parameters", () => {
    /** @scenario "Resolved parameter values are recorded on the run and shown in the run detail drawer" */
    /** @scenario "Custom metadata passes through from ingestion to read projection" */
    it("reads them back off the run", async () => {
      const scenarioId = `scenario-${nanoid()}`;
      const command = await queuedCommandFor({
        scenarioId,
        parameters: { account_tier: "platinum", seats: 12, trial: false },
      });

      await recordQueuedRun(command);

      const run = await readRepository.getScenarioRunData({
        projectId: tenantId,
        scenarioRunId: command.scenarioRunId,
      });

      expect(run).not.toBeNull();
      expect(run!.metadata).toMatchObject({
        parameters: { account_tier: "platinum", seats: 12, trial: false },
      });
    });

    /** @scenario "Custom metadata passes through from ingestion to read projection" */
    it("keeps the platform metadata the run always carried", async () => {
      const scenarioId = `scenario-${nanoid()}`;
      const command = await queuedCommandFor({
        scenarioId,
        parameters: { region: "eu-central" },
      });

      await recordQueuedRun(command);

      const run = await readRepository.getScenarioRunData({
        projectId: tenantId,
        scenarioRunId: command.scenarioRunId,
      });

      expect(run!.metadata).toMatchObject({
        langwatch: { targetReferenceId: "agent-1" },
      });
    });
  });

  describe("given a run started with no parameter values", () => {
    it("records the metadata it always did, with no empty parameters entry", async () => {
      const scenarioId = `scenario-${nanoid()}`;
      const command = await queuedCommandFor({ scenarioId });

      await recordQueuedRun(command);

      const run = await readRepository.getScenarioRunData({
        projectId: tenantId,
        scenarioRunId: command.scenarioRunId,
      });

      expect(run!.metadata).toEqual({
        langwatch: { targetReferenceId: "agent-1" },
      });
    });
  });
});
