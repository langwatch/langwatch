/**
 * Per-criterion verdicts on the set-level and all-suites list reads, which
 * select the trimmed projection rather than the whole row.
 * @see specs/scenarios/judge-criterion-verdicts.feature
 */

import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SimulationClickHouseRepository } from "../simulation-clickhouse.repository.ts";

const configuredClickHouseUrl = process.env.TEST_CLICKHOUSE_URL ?? process.env.CI_CLICKHOUSE_URL;
const databaseUrl = configuredClickHouseUrl ? new URL(configuredClickHouseUrl) : null;
if (databaseUrl && !process.env.TEST_CLICKHOUSE_URL) {
  databaseUrl.pathname = "/test_langwatch";
}

const tenantId = `test-sim-criteria-list-${nanoid()}`;
const now = Date.now();

const expectedCriteria = [
  {
    criterion: "stays polite",
    requirement: "The agent stays polite",
    status: "passed",
    reasoning: "Every reply was courteous.",
  },
  {
    criterion: "opens a ticket",
    requirement: "The agent opens a support ticket",
    status: "inconclusive",
    reasoning: "No tool spans arrived.",
  },
];

/** A finished run as a new SDK stores it: the lists and the per-criterion columns. */
function makeNewSdkRunRow({ scenarioSetId }: { scenarioSetId: string }) {
  return {
    ProjectionId: `proj-${nanoid()}`,
    TenantId: tenantId,
    ScenarioRunId: `run-${nanoid()}`,
    ScenarioId: `scenario-${nanoid()}`,
    BatchRunId: `batch-${nanoid()}`,
    ScenarioSetId: scenarioSetId,
    Version: "v1",
    Status: "FAILURE",
    Name: "Refund flow",
    Description: null,
    Metadata: null,
    "Messages.Id": ["msg-1"],
    "Messages.Role": ["user"],
    "Messages.Content": ["hello"],
    "Messages.TraceId": [""],
    "Messages.Rest": ["{}"],
    TraceIds: [],
    Verdict: "failure",
    Reasoning: "One criterion could not be checked.",
    MetCriteria: ["stays polite"],
    UnmetCriteria: ["opens a ticket"],
    InconclusiveCriteria: ["opens a ticket"],
    "Criteria.Criterion": expectedCriteria.map((c) => c.criterion),
    "Criteria.Requirement": expectedCriteria.map((c) => c.requirement),
    "Criteria.Status": expectedCriteria.map((c) => c.status),
    "Criteria.Reasoning": expectedCriteria.map((c) => c.reasoning),
    Error: null,
    DurationMs: "1500",
    StartedAt: new Date(now - 5000),
    CreatedAt: new Date(now - 5000),
    UpdatedAt: new Date(now),
    FinishedAt: new Date(now),
    ArchivedAt: null,
    LastSnapshotOccurredAt: new Date(0),
  };
}

let client: ClickHouseClient | undefined;
let repo: SimulationClickHouseRepository;

async function insertRow(row: ReturnType<typeof makeNewSdkRunRow>) {
  if (!client) throw new Error("ClickHouse integration environment is unavailable");
  await client.insert({
    table: "simulation_runs",
    values: [row],
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

describe.skipIf(databaseUrl === null)("per-criterion verdicts on list reads", () => {
  describe("when a new-SDK run is read through the set-level list", () => {
    /** @scenario "A list read carries each criterion's requirement and reasoning" */
    it("carries each criterion's requirement and reasoning", async () => {
      const scenarioSetId = `set-criteria-${nanoid()}`;
      await insertRow(makeNewSdkRunRow({ scenarioSetId }));

      const result = await repo.listRunDataForScenarioSet({
        projectId: tenantId,
        scenarioSetId,
        limit: 10,
      });

      expect(result.runs).toHaveLength(1);
      expect(result.runs[0]!.results?.criteria).toEqual(expectedCriteria);
    });
  });

  describe("when a new-SDK run is read through the all-suites list", () => {
    /** @scenario "A list read carries each criterion's requirement and reasoning" */
    it("carries each criterion's requirement and reasoning", async () => {
      const scenarioSetId = `set-criteria-all-${nanoid()}`;
      await insertRow(makeNewSdkRunRow({ scenarioSetId }));

      const result = await repo.findRunDataForAllSuites({ projectId: tenantId, limit: 10 });

      const runs = result.changed ? result.runs : [];
      const run = runs.find((candidate) => candidate.scenarioSetId === scenarioSetId);
      expect(run?.results?.criteria).toEqual(expectedCriteria);
    });
  });
});
