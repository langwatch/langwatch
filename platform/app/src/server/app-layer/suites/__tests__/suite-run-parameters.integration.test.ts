/**
 * The parameter values a run resolved have to survive the whole recording
 * path, not just the call that starts the run: the queued command carries them
 * as metadata, the fold projection is what turns that metadata into a stored
 * column, and the read repository is what a run detail drawer actually reads.
 * Assert each hop in one place, against a real ClickHouse, because a break in
 * any of them looks identical from the outside: a run that started fine and
 * shows nothing.
 *
 * A secret parameter travels the same path with the opposite requirement: the
 * name has to arrive and the value has to not, in any form, at every hop.
 *
 * @see specs/scenarios/scenario-run-parameters.feature
 * @see specs/scenarios/secret-run-parameters.feature
 */

import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
import { encryptRunSecretValues } from "~/server/scenarios/run-secret-values";
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
  secretParameters?: Record<string, string>;
  simulatorModel?: string | null;
  judgeModel?: string | null;
}): Promise<QueueRunCommandData> {
  const queued: QueueRunCommandData[] = [];
  const service = new SuiteRunService(new NullSuiteRunReadRepository(), {
    startSuiteRun: async () => {},
    queueSimulationRun: async (data) => {
      queued.push(data);
    },
  });

  await service.startRun({
    suiteId: `suite-${nanoid()}`,
    projectId: tenantId,
    activeScenarioIds: [params.scenarioId],
    scenarioNameMap: new Map([[params.scenarioId, "Refund flow"]]),
    scenarioVersionMap: new Map([[params.scenarioId, 1]]),
    activeTargets: [{ type: "http", referenceId: "agent-1" }],
    repeatCount: 1,
    skippedArchived: { scenarios: [], targets: [] },
    idempotencyKey: `idem-${nanoid()}`,
    simulatorModel: params.simulatorModel ?? null,
    judgeModel: params.judgeModel ?? null,
    ...(params.parameters && {
      parametersByScenarioId: new Map([[params.scenarioId, params.parameters]]),
    }),
    ...(params.secretParameters && {
      secretParametersByScenarioId: new Map([
        [params.scenarioId, encryptRunSecretValues(params.secretParameters)],
      ]),
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

  describe("given a run started with a secret parameter value", () => {
    const SECRET_VALUE = "tok-live-abc123";

    /** @scenario "A secret value is never written to the simulation runs store" */
    it("records the name and neither the value nor its encrypted form", async () => {
      const scenarioId = `scenario-${nanoid()}`;
      const command = await queuedCommandFor({
        scenarioId,
        parameters: { region: "eu-central" },
        secretParameters: { api_token: SECRET_VALUE },
      });

      // The command carries the encrypted value beside the metadata, never
      // inside it: what the fold projection stores is built from the metadata.
      expect(command.secretParameters?.api_token).toBeDefined();
      expect(command.secretParameters?.api_token).not.toContain(SECRET_VALUE);
      expect(JSON.stringify(command.metadata)).not.toContain(SECRET_VALUE);

      // The command schema strips what it does not declare, so a field the
      // dispatch path drops would never reach execution at all.
      const validated = QueueRunCommand.schema.validate(command);
      expect(validated.success).toBe(true);
      expect(
        (validated as { data: { secretParameters?: Record<string, string> } })
          .data.secretParameters,
      ).toEqual(command.secretParameters);

      await recordQueuedRun(command);

      const stored = await ch.query({
        query: `SELECT Metadata FROM simulation_runs WHERE TenantId = {tenantId:String} AND ScenarioRunId = {scenarioRunId:String}`,
        query_params: { tenantId, scenarioRunId: command.scenarioRunId },
        format: "JSONEachRow",
      });
      const rows = (await stored.json()) as { Metadata: string }[];
      const metadata = rows[0]!.Metadata;

      expect(metadata).not.toContain(SECRET_VALUE);
      expect(metadata).not.toContain(command.secretParameters!.api_token!);
      expect(metadata).not.toContain('secretParameters"');
      expect(JSON.parse(metadata)).toMatchObject({
        parameters: { region: "eu-central" },
        secretParameterNames: ["api_token"],
      });
    });

    /** @scenario "The runs API never returns a secret value" */
    it("serves the run back without a value or an encrypted form", async () => {
      const scenarioId = `scenario-${nanoid()}`;
      const command = await queuedCommandFor({
        scenarioId,
        secretParameters: { api_token: SECRET_VALUE },
      });

      await recordQueuedRun(command);

      const run = await readRepository.getScenarioRunData({
        projectId: tenantId,
        scenarioRunId: command.scenarioRunId,
      });

      const served = JSON.stringify(run);
      expect(served).not.toContain(SECRET_VALUE);
      expect(served).not.toContain(command.secretParameters!.api_token!);
      expect(run!.metadata).toMatchObject({
        secretParameterNames: ["api_token"],
      });
      expect(run!.metadata).not.toHaveProperty("secretParameters");
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
        langwatch: {
          targetReferenceId: "agent-1",
          targetType: "http",
          scenarioVersion: 1,
        },
      });
    });
  });
});

describe("Feature: recording the simulation models a run was configured with", () => {
  describe("given a run plan that names both models", () => {
    /** @scenario "A run records the simulation models its plan was configured with" */
    it("reads both back off the run", async () => {
      const command = await queuedCommandFor({
        scenarioId: `scenario-${nanoid()}`,
        simulatorModel: "openai/gpt-5-mini",
        judgeModel: "openai/gpt-5",
      });

      await recordQueuedRun(command);

      const run = await readRepository.getScenarioRunData({
        projectId: tenantId,
        scenarioRunId: command.scenarioRunId,
      });

      expect(run!.metadata).toMatchObject({
        langwatch: {
          simulatorModel: "openai/gpt-5-mini",
          judgeModel: "openai/gpt-5",
        },
      });
    });
  });

  describe("given a run plan that names neither model", () => {
    // A plan naming no model runs on the project default and records no
    // model, so it keys the same as a run recorded before models were
    // stamped at all.
    /** @scenario "A run plan that names no model records no model" */
    it("records neither key", async () => {
      const command = await queuedCommandFor({
        scenarioId: `scenario-${nanoid()}`,
      });

      await recordQueuedRun(command);

      const run = await readRepository.getScenarioRunData({
        projectId: tenantId,
        scenarioRunId: command.scenarioRunId,
      });

      const langwatch = (
        run!.metadata as { langwatch: Record<string, unknown> }
      ).langwatch;
      expect(langwatch).not.toHaveProperty("simulatorModel");
      expect(langwatch).not.toHaveProperty("judgeModel");
    });
  });

  describe("given a run plan that names only the judge model", () => {
    /** @scenario "A plan that names only one of the two models records only that one" */
    it("records that one and not the other", async () => {
      const command = await queuedCommandFor({
        scenarioId: `scenario-${nanoid()}`,
        judgeModel: "openai/gpt-5",
      });

      await recordQueuedRun(command);

      const run = await readRepository.getScenarioRunData({
        projectId: tenantId,
        scenarioRunId: command.scenarioRunId,
      });

      const langwatch = (
        run!.metadata as { langwatch: Record<string, unknown> }
      ).langwatch;
      expect(langwatch.judgeModel).toBe("openai/gpt-5");
      expect(langwatch).not.toHaveProperty("simulatorModel");
    });
  });
});
