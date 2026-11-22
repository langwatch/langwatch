/**
 * The results page's cheap change check: a "Test agent" run in the project's agent test set
 * never reaches the page, so it never reads as a change.
 * @see specs/agents/agent-test-run.feature
 */

import { getAgentTestSetId } from "@langwatch/scenario-contract";
import { nanoid } from "nanoid";
import { describe, expect, it } from "vitest";

import {
  databaseUrl,
  simulationRunRow,
  useSimulationClickHouse,
} from "./simulation-clickhouse-rows.fixture.ts";

const tenantId = `test-agent-test-set-${nanoid()}`;
const now = Date.now();

const ch = useSimulationClickHouse({ tenantId });

describe.skipIf(databaseUrl === null)("the results page's change check", () => {
  describe("when a batch in the agent test set is newer than every other run", () => {
    /** @scenario "A test run does not make the results page look stale" */
    it("answers that nothing changed since the last read", async () => {
      const olderStart = new Date(now - 60_000);
      const listed = simulationRunRow({
        tenantId,
        scenarioSetId: "customer-set",
        batchRunId: `batch-${nanoid(6)}`,
        metadata: null,
        startedAt: olderStart,
      });
      const agentTest = simulationRunRow({
        tenantId,
        scenarioSetId: getAgentTestSetId(tenantId),
        batchRunId: `batch-${nanoid(6)}`,
        metadata: null,
      });
      await ch.insertRows([listed, agentTest]);
      const lastRead = listed.UpdatedAt.getTime();

      const answer = await ch.repo.findRunDataForAllSuites({
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
      const agentTest = simulationRunRow({
        tenantId,
        scenarioSetId: getAgentTestSetId(tenantId),
        batchRunId: `batch-${nanoid(6)}`,
        metadata: null,
      });
      await ch.insertRows([agentTest]);

      const run = await ch.repo.findScenarioRunData({
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
