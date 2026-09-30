/**
 * The results page's cheap change check: a "Test agent" run in the project's agent test set
 * never reaches the page, so it never reads as a change.
 * @see specs/agents/agent-test-run.feature
 */

import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { getAgentTestSetId } from "@langwatch/scenario-contract";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SimulationClickHouseRepository } from "../simulation-clickhouse.repository.ts";

const configuredClickHouseUrl = process.env.TEST_CLICKHOUSE_URL ?? process.env.CI_CLICKHOUSE_URL;
const databaseUrl = configuredClickHouseUrl ? new URL(configuredClickHouseUrl) : null;
if (databaseUrl && !process.env.TEST_CLICKHOUSE_URL) {
  databaseUrl.pathname = "/test_langwatch";
}

const tenantId = `test-agent-test-set-${nanoid()}`;
const now = Date.now();

function makeRunRow({
  scenarioSetId,
  batchRunId,
  metadata,
  startedAt = new Date(now - 5000),
}: {
  scenarioSetId: string;
  batchRunId: string;
  metadata: Record<string, unknown> | null;
  startedAt?: Date;
}) {
  return {
    ProjectionId: `proj-${nanoid()}`,
    TenantId: tenantId,
    ScenarioRunId: `run-${nanoid()}`,
    ScenarioId: `scenario-${nanoid()}`,
    BatchRunId: batchRunId,
    ScenarioSetId: scenarioSetId,
    Version: "v1",
    Status: "SUCCESS",
    Name: "Refund Flow",
    Description: null,
    Metadata: metadata === null ? null : JSON.stringify(metadata),
    "Messages.Id": ["msg-1"],
    "Messages.Role": ["user"],
    "Messages.Content": ["hello"],
    "Messages.TraceId": ["trace-1"],
    "Messages.Rest": ["{}"],
    TraceIds: [],
    Verdict: "success",
    Reasoning: "All good",
    MetCriteria: ["criterion-1"],
    UnmetCriteria: [],
    Error: null,
    DurationMs: "1500",
    StartedAt: startedAt,
    CreatedAt: startedAt,
    UpdatedAt: new Date(startedAt.getTime() + 1000),
    FinishedAt: new Date(startedAt.getTime() + 1000),
    ArchivedAt: null,
    LastSnapshotOccurredAt: new Date(0),
  };
}

let client: ClickHouseClient | undefined;
let repo: SimulationClickHouseRepository;

async function insertRows(rows: ReturnType<typeof makeRunRow>[]) {
  if (!client) throw new Error("ClickHouse integration environment is unavailable");
  await client.insert({
    table: "simulation_runs",
    values: rows,
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
  repo = SimulationClickHouseRepository.create(async () => client!);
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

describe.skipIf(databaseUrl === null)("the results page's change check", () => {
  describe("when a batch in the agent test set is newer than every other run", () => {
    /** @scenario "A test run does not make the results page look stale" */
    it("answers that nothing changed since the last read", async () => {
      const olderStart = new Date(now - 60_000);
      const listed = makeRunRow({
        scenarioSetId: "customer-set",
        batchRunId: `batch-${nanoid(6)}`,
        metadata: null,
        startedAt: olderStart,
      });
      const agentTest = makeRunRow({
        scenarioSetId: getAgentTestSetId(tenantId),
        batchRunId: `batch-${nanoid(6)}`,
        metadata: null,
      });
      await insertRows([listed, agentTest]);
      const lastRead = listed.UpdatedAt.getTime();

      const answer = await repo.findRunDataForAllSuites({
        projectId: tenantId,
        sinceTimestamp: lastRead,
      });

      expect(answer).toEqual({ changed: false, lastUpdatedAt: lastRead });
    });
  });
});

describe.skipIf(databaseUrl === null)("the run drawer of a test run", () => {
  describe("when it is opened with the scenario run id of a run in the agent test set", () => {
    /** @scenario "The run drawer opens a test run by its id" */
    it("reads the run's state like any other run", async () => {
      const agentTest = makeRunRow({
        scenarioSetId: getAgentTestSetId(tenantId),
        batchRunId: `batch-${nanoid(6)}`,
        metadata: null,
      });
      await insertRows([agentTest]);

      const run = await repo.findScenarioRunData({
        projectId: tenantId,
        scenarioRunId: agentTest.ScenarioRunId,
      });

      expect(run).toMatchObject({
        scenarioRunId: agentTest.ScenarioRunId,
        batchRunId: agentTest.BatchRunId,
      });
    });
  });
});
