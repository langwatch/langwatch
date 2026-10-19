/**
 * The target key and its overrides, as the run detail reads them back: the
 * metadata the execution service queues is what gets stored, and the run
 * read is what a drawer actually shows.
 * @see specs/scenarios/scenario-run-parameters.feature
 */

import { createClient, type ClickHouseClient } from "@clickhouse/client";
import type { SimulationQueueRun } from "@langwatch/scenario-contract";
import { targetKeyOf, type SuiteTarget } from "@langwatch/suite-contract";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SimulationClickHouseRepository } from "../simulation-clickhouse.repository.ts";

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

/** The queued run as the suite sends it for that target: metadata included. */
function queueRunAgainstTarget(): SimulationQueueRun {
  return {
    tenantId,
    scenarioRunId: `scenariorun-${nanoid()}`,
    scenarioId,
    batchRunId: `batch-${nanoid()}`,
    scenarioSetId: `suiteset-${nanoid()}`,
    name: "Refund flow",
    metadata: {
      langwatch: {
        targetReferenceId: target.referenceId,
        targetType: target.type,
        targetKey: targetKeyOf(target),
        targetParameters: target.runParameters,
        scenarioVersion: 1,
      },
      parameters: { model: "gpt-5-mini", region: "eu-central" },
    },
    target: { type: target.type, referenceId: target.referenceId },
    occurredAt: Date.now(),
  };
}

/** Stores the queued run the way the fold projection lands it. */
async function storeRun(command: SimulationQueueRun): Promise<void> {
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

beforeAll(() => {
  if (!databaseUrl) return;
  client = createClient({
    url: databaseUrl,
    clickhouse_settings: { date_time_input_format: "best_effort" },
  });
  repository = SimulationClickHouseRepository.create(async () => client!);
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

describe.skipIf(databaseUrl === null)(
  "given a run queued against a target carrying an override",
  () => {
    describe("when the run is stored and read back", () => {
      /** @scenario The target key and its parameters read back off the stored run */
      it("reads the target key and the override back under the reserved langwatch namespace", async () => {
        const command = queueRunAgainstTarget();
        await storeRun(command);

        const run = await repository.findScenarioRunData({
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
  },
);
