/**
 * A test suite's finished runs, as the Test Runs list and its runs sidebar read
 * them: the suite's internal run set, and the batches inside it.
 * @see specs/suites/test-suite-run-plan-reuse.feature
 */

import { getSuiteSetId } from "@langwatch/suite-contract";
import { nanoid } from "nanoid";
import { describe, expect, it } from "vitest";

import {
  databaseUrl,
  simulationRunRow,
  useSimulationClickHouse,
} from "./simulation-clickhouse-rows.fixture.ts";

const tenantId = `test-suite-results-${nanoid()}`;

const ch = useSimulationClickHouse({ tenantId });

describe.skipIf(databaseUrl === null)("a test suite's runs in the results view", () => {
  describe("when a test suite's internal run set holds a finished batch", () => {
    /** @scenario "A test suite run appears in the results view under the test suite's name" */
    it("lists the run plan that run resolved among the internal suite sets", async () => {
      const testSuiteId = `suite-${nanoid(6)}`;
      const setId = getSuiteSetId(testSuiteId);
      await ch.insertRows([
        simulationRunRow({
          tenantId,
          scenarioSetId: setId,
          batchRunId: `batch-${nanoid(6)}`,
          metadata: null,
        }),
      ]);

      const summaries = await ch.repo.findInternalSuiteSummaries({ projectId: tenantId });

      const suiteSummary = summaries.find((summary) => summary.scenarioSetId === setId);
      expect(suiteSummary).toBeDefined();
      expect(suiteSummary?.totalCount).toBe(1);
    });

    /** @scenario "A test suite run appears in the results view under the test suite's name" */
    it("shows that batch in the set's run history when the plan is opened", async () => {
      const testSuiteId = `suite-open-${nanoid(6)}`;
      const setId = getSuiteSetId(testSuiteId);
      const batchRunId = `batch-open-${nanoid(6)}`;
      await ch.insertRows([
        simulationRunRow({
          tenantId,
          scenarioSetId: setId,
          batchRunId,
          metadata: null,
        }),
        simulationRunRow({
          tenantId,
          scenarioSetId: setId,
          batchRunId,
          metadata: null,
        }),
      ]);

      const history = await ch.repo.listBatchHistoryForScenarioSet({
        projectId: tenantId,
        scenarioSetId: setId,
        limit: 10,
      });

      expect(history.batches.map((batch) => batch.batchRunId)).toContain(batchRunId);
    });

    /**
     * A test suite's set is internal by construction, and the Simulations pages
     * read the external sets. A suite that leaked into that list would show up
     * on the v1 pages the spec says must never show one.
     */
    /** @scenario "A test suite run appears in the results view under the test suite's name" */
    it("keeps the suite's set out of the external sets the Simulations pages read", async () => {
      const setId = getSuiteSetId(`suite-external-${nanoid(6)}`);
      await ch.insertRows([
        simulationRunRow({
          tenantId,
          scenarioSetId: setId,
          batchRunId: `batch-ext-${nanoid(6)}`,
          metadata: null,
        }),
      ]);

      const external = await ch.repo.findExternalSetSummaries({ projectId: tenantId });

      expect(external.map((summary) => summary.scenarioSetId)).not.toContain(setId);
    });
  });
});
