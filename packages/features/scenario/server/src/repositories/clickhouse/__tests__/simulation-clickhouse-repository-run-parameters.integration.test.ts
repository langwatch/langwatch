/**
 * The target key and its overrides, as the run detail reads them back: the
 * metadata the execution service queues is what gets stored, and the run read
 * is what a drawer actually shows.
 *
 * @see specs/scenarios/scenario-run-parameters.feature
 */

import { createClient, type ClickHouseClient } from "@clickhouse/client";
import type { ScenarioService } from "@langwatch/scenario-contract";
import { targetKeyOf, type SuiteTarget } from "@langwatch/suite-contract";
import {
  SuiteExecutionService,
  type QueueSimulationRunCommandData,
} from "@langwatch/suite-server/testing";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SimulationWindowedReadPort } from "../../../ports/simulation-windowed-read.port.ts";
import { SimulationClickHouseRepository } from "../simulation-clickhouse.repository.ts";

/** The repository's own hint window, derived the way production derives it. */
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

const tenantId = `test-run-parameters-${nanoid()}`;
const scenarioId = `scenario-${nanoid()}`;
const target: SuiteTarget = {
  type: "http",
  referenceId: "prod-agent",
  runParameters: { model: "gpt-5-mini" },
};

let client: ClickHouseClient | undefined;
let repository: SimulationClickHouseRepository;

/** The command the execution service queues for that target: metadata included. */
async function queueRunAgainstTarget(): Promise<QueueSimulationRunCommandData> {
  const queued: QueueSimulationRunCommandData[] = [];
  const service = SuiteExecutionService.create({
    commands: {
      startSuiteRun: async () => {},
      queueSimulationRun: async (data) => {
        queued.push(data);
      },
    },
    ids: { next: () => `scenariorun_${nanoid()}` },
    scenarios: {
      resolveRunParametersForScenarios: async ({ scenarios }: { scenarios: { id: string }[] }) =>
        scenarios.map((scenario) => ({
          scenarioId: scenario.id,
          parameters: { model: "gpt-5-mini", region: "eu-central" },
          secretParameters: {},
          scenarioVersion: 1,
        })),
    } as unknown as ScenarioService,
  });

  await service.execute({
    suiteId: `suite-${nanoid()}`,
    projectId: tenantId,
    activeScenarioIds: [scenarioId],
    scenarioNames: new Map([[scenarioId, "Refund flow"]]),
    scenarioVersions: new Map([[scenarioId, 1]]),
    scenarioConfigs: [
      {
        id: scenarioId,
        name: "Refund flow",
        version: 1,
        situation: "A customer asks for a refund",
        criteria: [],
        parameters: {},
      },
    ],
    activeTargets: [target],
    repeatCount: 1,
    skippedArchived: { scenarios: [], targets: [] },
    idempotencyKey: `idem-${nanoid()}`,
    simulatorModel: null,
    judgeModel: null,
  });

  const command = queued[0];
  if (!command) throw new Error("the execution service queued no run");
  return command;
}

/** Stores the queued run the way the fold projection lands it. */
async function storeRun(command: QueueSimulationRunCommandData): Promise<void> {
  if (!client) throw new Error("ClickHouse integration environment is unavailable");
  const startedAt = new Date(Date.now() - 5_000);
  await client.insert({
    table: "simulation_runs",
    values: [
      {
        ProjectionId: `proj-${nanoid()}`,
        TenantId: tenantId,
        ScenarioRunId: command.scenarioRunId,
        ScenarioId: command.scenarioId,
        BatchRunId: command.batchRunId,
        ScenarioSetId: command.scenarioSetId,
        Version: "v1",
        Status: "IN_PROGRESS",
        Name: command.name ?? "Refund flow",
        Description: null,
        Metadata: JSON.stringify(command.metadata),
        "Messages.Id": [],
        "Messages.Role": [],
        "Messages.Content": [],
        "Messages.TraceId": [],
        "Messages.Rest": [],
        TraceIds: [],
        Verdict: null,
        Reasoning: null,
        MetCriteria: [],
        UnmetCriteria: [],
        Error: null,
        DurationMs: "0",
        StartedAt: startedAt,
        CreatedAt: startedAt,
        UpdatedAt: startedAt,
        FinishedAt: null,
        ArchivedAt: null,
        LastSnapshotOccurredAt: new Date(0),
      },
    ],
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
  repository = SimulationClickHouseRepository.create(async () => client!, new HintWindowedRead());
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

integration("given a run queued against a target carrying an override", () => {
  describe("when the run is stored and read back", () => {
    /** @scenario The target key and its parameters read back off the stored run */
    it("reads the target key and the override back under the reserved langwatch namespace", async () => {
      const command = await queueRunAgainstTarget();
      await storeRun(command);

      const run = await repository.tryGetScenarioRunData({
        projectId: tenantId,
        scenarioRunId: command.scenarioRunId,
      });

      const targetKey = targetKeyOf(target);
      expect(targetKey).not.toBe("prod-agent");
      expect(run?.metadata).toMatchObject({
        langwatch: {
          targetReferenceId: "prod-agent",
          targetKey,
          targetParameters: { model: "gpt-5-mini" },
        },
        parameters: { model: "gpt-5-mini", region: "eu-central" },
      });
    });
  });
});
