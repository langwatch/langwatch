import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  createWorkerScenarioProcessing,
  WorkerScenarioAbsenceReportPort,
} from "../worker-scenario-processing.composition";
import type { ExecuteRunIntent } from "@langwatch/scenario-server";
import { resolveWorkerScenarioExecutionPrerequisites } from "../worker-scenario-execution.composition";

/**
 * THE CONVERSION, asserted where it can actually fail.
 * Spec: specs/scenarios/worker-simulation-pipeline-conversion.feature
 */

const RECORDED: {
  broadcasts: Array<{ tenantId: string; event: string; eventType: string }>;
  suite: Array<{ command: string; data: unknown }>;
  absences: string[];
  commands: Array<{ name: string; data: unknown }>;
} = { broadcasts: [], suite: [], absences: [], commands: [] };

function reset(): void {
  RECORDED.broadcasts.length = 0;
  RECORDED.suite.length = 0;
  RECORDED.absences.length = 0;
  RECORDED.commands.length = 0;
}

class RecordingAbsence extends WorkerScenarioAbsenceReportPort {
  withoutExecutionPool(): void {
    RECORDED.absences.push("executionPool");
  }
}

function compose(overrides: { executionPool?: { submit(job: unknown): void } } = {}) {
  return createWorkerScenarioProcessing({
    ...(overrides.executionPool ? { executionPool: overrides.executionPool as never } : {}),
    resolveClickHouseClient: (async () => ({
      insert: async () => undefined,
      query: async () => ({ json: async () => [] }),
    })) as never,
    defaultRetentionDays: 90,
    redis: {
      publish: async () => 1,
      get: async () => null,
      set: async () => "OK",
    } as never,
    traceSummaryStore: { get: async () => null, save: async () => undefined } as never,
    eventStore: { getEvents: async () => [] } as never,
    broadcast: {
      broadcastToTenant: async (input: { tenantId: string; event: string; eventType: string }) => {
        RECORDED.broadcasts.push(input);
      },
    } as never,
    suiteRuns: {
      recordSuiteRunItemStarted: async (data) => {
        RECORDED.suite.push({ command: "recordSuiteRunItemStarted", data });
      },
      completeSuiteRunItem: async (data) => {
        RECORDED.suite.push({ command: "completeSuiteRunItem", data });
      },
    },
    absence: new RecordingAbsence(),
  });
}

/** The routing keys the frozen registry lists for `simulation_processing`. */
function frozenScenarioRoutingKeys(): string[] {
  const registry = JSON.parse(
    readFileSync(new URL("../../features/job-registry.json", import.meta.url), "utf8"),
  ) as { pipelines: Array<{ name: string; jobs: string[] }> };
  const pipeline = registry.pipelines.find((entry) => entry.name === "simulation_processing");
  if (!pipeline) throw new Error("simulation_processing is absent from the job registry");
  return pipeline.jobs;
}

type BuiltDefinition = {
  metadata: { name: string };
  aggregate: { type: string };
  foldProjections: Map<string, unknown>;
  stateProjections?: Map<string, unknown>;
  mapProjections: Map<string, unknown>;
  commands: ReadonlyArray<{ name: string }>;
  foldSubscribers: Map<string, unknown>;
  mapSubscribers: Map<string, unknown>;
  eventSubscribers: Map<string, { handle: (event: never, ctx: never) => Promise<void> }>;
  processManagers: Map<
    string,
    {
      config: {
        eventTypes: readonly string[];
        // Only the execute intent is driven here, so the map is typed against
        // its own payload rather than against a union nothing would narrow.
        intents: Record<string, { run(payload: ExecuteRunIntent): Promise<void> } | undefined>;
      };
    }
  >;
};

function registeredKeys(definition: BuiltDefinition): Set<string> {
  const keys = new Set<string>();
  for (const name of definition.foldProjections.keys()) keys.add(`projection:${name}`);
  for (const name of definition.stateProjections?.keys() ?? []) keys.add(`stateProjection:${name}`);
  for (const name of definition.mapProjections.keys()) keys.add(`handler:${name}`);
  for (const command of definition.commands) keys.add(`command:${command.name}`);
  for (const name of definition.foldSubscribers.keys()) keys.add(`reactor:${name}`);
  for (const name of definition.mapSubscribers.keys()) keys.add(`reactor:${name}`);
  for (const name of definition.eventSubscribers.keys()) keys.add(`subscriber:${name}`);
  for (const [name, manager] of definition.processManagers) {
    if (manager.config.eventTypes.length > 0) keys.add(`subscriber:pm:${name}`);
  }
  return keys;
}

describe("given the simulation pipeline this process composes for itself", () => {
  describe("when the composition root builds it", () => {
    /** @scenario "The worker mounts every simulation routing key" */
    it("registers every routing key the registry lists but the retry the installer owns", () => {
      reset();
      const definition = compose().buildProcessing() as unknown as BuiltDefinition;
      const registered = registeredKeys(definition);

      const frozen = frozenScenarioRoutingKeys();
      expect(frozen.filter((key) => !registered.has(key))).toEqual([
        // Registered beside the pipeline, against the live service, from the
        // package's own job spec — named here so it cannot hide in a subtraction.
        "job:deferredComputeRunMetrics",
      ]);
      expect([...registered].filter((key) => !frozen.includes(key))).toEqual([]);
      expect(frozen).toHaveLength(16);
    });

    /** @scenario "The worker mounts every simulation routing key" */
    it("names the pipeline and aggregate the queue routes on", () => {
      reset();
      const definition = compose().buildProcessing() as unknown as BuiltDefinition;

      expect(definition.metadata.name).toBe("simulation_processing");
      expect(definition.aggregate.type).toBe("simulation_run");
    });
  });

  describe("when a run advances", () => {
    /** @scenario "A simulation snapshot reaches the tenant's own tabs" */
    it("publishes the snapshot through the one tenant bridge this process composed", async () => {
      reset();
      const definition = compose().buildProcessing() as unknown as BuiltDefinition;
      const subscriber = definition.eventSubscribers.get("snapshotUpdateBroadcast");
      if (!subscriber) throw new Error("the pipeline registered no snapshotUpdateBroadcast");

      await subscriber.handle(
        {
          id: "evt_1",
          type: "lw.simulation_run.message_snapshot",
          tenantId: "project-1",
          aggregateId: "run-1",
          occurredAt: Date.now(),
          data: { scenarioRunId: "run-1", batchRunId: "batch-1", scenarioSetId: "set-1" },
        } as never,
        { tenantId: "project-1", aggregateId: "run-1" } as never,
      );

      expect(RECORDED.broadcasts).toEqual([
        expect.objectContaining({ tenantId: "project-1", eventType: "simulation_updated" }),
      ]);
    });
  });

  describe("when a run starts inside a suite", () => {
    /** @scenario "A simulation run reports into its suite run" */
    it("records the item through the suite feature's own command", async () => {
      reset();
      const definition = compose().buildProcessing() as unknown as BuiltDefinition;
      const subscriber = definition.eventSubscribers.get("suiteRunSync");
      if (!subscriber) throw new Error("the pipeline registered no suiteRunSync");

      await subscriber.handle(
        {
          id: "evt_1",
          type: "lw.simulation_run.started",
          tenantId: "project-1",
          aggregateId: "run-1",
          occurredAt: Date.now(),
          data: {
            scenarioRunId: "run-1",
            batchRunId: "batch-1",
            scenarioSetId: "__internal__suite-1__suite",
            scenarioId: "scenario-1",
          },
        } as never,
        { tenantId: "project-1", aggregateId: "run-1" } as never,
      );

      expect(RECORDED.suite.map((entry) => entry.command)).toEqual(["recordSuiteRunItemStarted"]);
    });
  });

  describe("when this process composes no execution pool", () => {
    /** @scenario "A worker without an execution pool says so at boot" */
    it("reports the absence by name at composition time", () => {
      reset();
      compose();

      expect(RECORDED.absences).toEqual(["executionPool"]);
    });
  });

  describe("when this process composes an execution pool", () => {
    /** @scenario "A worker holding an execution pool starts a queued run" */
    it("submits the queued run to that pool and reports no absence", async () => {
      reset();
      const submitted: Array<{ scenarioRunId: string }> = [];
      const definition = compose({
        executionPool: {
          submit: (job) => submitted.push(job as { scenarioRunId: string }),
        },
      }).buildProcessing() as unknown as BuiltDefinition;

      const process = definition.processManagers.get("simulation_run_execution");
      if (!process) throw new Error("the pipeline registered no simulation_run_execution");
      const execute = process.config.intents.execute;
      if (!execute) throw new Error("the process manager declared no execute intent");

      await execute.run({
        projectId: "project-1",
        scenarioId: "scenario-1",
        scenarioRunId: "run-1",
        batchRunId: "batch-1",
        scenarioSetId: "set-1",
        target: { type: "http", referenceId: "agent-1" },
      });

      expect(submitted.map((job) => job.scenarioRunId)).toEqual(["run-1"]);
      expect(RECORDED.absences).toEqual([]);
    });
  });
});

describe("given a worker deciding whether it can execute simulations", () => {
  describe("when one execution input is missing", () => {
    /** @scenario "A worker missing one execution input composes no executor" */
    it("composes no executor and names the missing input", () => {
      const named: string[] = [];

      const prerequisites = resolveWorkerScenarioExecutionPrerequisites({
        config: {
          serviceName: "worker",
          nodeEnvironment: "test",
          deployment: { saas: false },
          automation: { credentialsEncryptionKey: "a".repeat(64) },
          infrastructure: {
            execution: { langwatchEndpoint: undefined, defaultModel: "openai/gpt-5-mini" },
            modelProvider: {
              nlpServiceUrl: "http://nlp.test",
              blockLocalHttpCalls: true,
              allowedProxyHosts: [],
            },
          },
        } as never,
        connection: { client: {} } as never,
        modelProviders: {} as never,
        projects: {} as never,
        redis: {} as never,
        resolveClickHouseClient: (async () => ({})) as never,
        defaultRetentionDays: 90,
        absence: {
          withoutExecutor: (reason: string) => named.push(reason),
        } as never,
      });

      expect(prerequisites).toBeUndefined();
      expect(named).toEqual(["no-telemetry-endpoint"]);
    });
  });
});
