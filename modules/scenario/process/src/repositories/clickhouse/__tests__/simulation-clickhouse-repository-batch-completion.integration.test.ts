/**
 * Batch completion counts and the batch-scoped run list, read off real rows.
 * @see specs/features/simulation-runs-batch-completion.feature
 * @see specs/features/simulation-runs-batch-filter.feature
 */

import { nanoid } from "nanoid";
import { describe, expect, it } from "vitest";

import {
  databaseUrl,
  simulationRunRow,
  useSimulationClickHouse,
} from "./simulation-clickhouse-rows.fixture.ts";

const tenantId = `test-batch-completion-${nanoid()}`;

/** A completion row: its status and run id are the point, it carries no messages or criteria. */
function makeRunRow({
  scenarioSetId,
  batchRunId,
  status = "SUCCESS",
  scenarioRunId = `run-${nanoid()}`,
}: {
  scenarioSetId: string;
  batchRunId: string;
  status?: string;
  scenarioRunId?: string;
}) {
  return {
    ...simulationRunRow({ tenantId, scenarioSetId, batchRunId, metadata: null }),
    ScenarioRunId: scenarioRunId,
    Status: status,
    "Messages.Id": [],
    "Messages.Role": [],
    "Messages.Content": [],
    "Messages.TraceId": [],
    "Messages.Rest": [],
    Reasoning: null,
    MetCriteria: [],
  };
}

const ch = useSimulationClickHouse({ tenantId });

async function seedBatch(statuses: string[]) {
  const scenarioSetId = `set-${nanoid()}`;
  const batchRunId = `batch-${nanoid()}`;
  await ch.insertRows(statuses.map((status) => makeRunRow({ scenarioSetId, batchRunId, status })));
  return { scenarioSetId, batchRunId };
}

describe.skipIf(databaseUrl === null)("the completion of a batch", () => {
  describe("given the batch still holds a queued run", () => {
    describe("when the batch aggregate is read", () => {
      /** @scenario "A batch with queued runs is not complete" */
      it("counts the queued run as running and the finished one as settled", async () => {
        const { batchRunId } = await seedBatch(["SUCCESS", "QUEUED"]);

        const summary = await ch.repo.findBatchSummary({ projectId: tenantId, batchRunId });

        expect(summary?.totalCount).toBe(2);
        expect(summary?.runningCount).toBe(1);
        expect(summary?.settledCount).toBe(1);
      });

      /** @scenario "allCompletedAt stays null until the last run settles" */
      it("leaves allCompletedAt null while the queued run waits", async () => {
        const { batchRunId } = await seedBatch(["SUCCESS", "QUEUED"]);

        const summary = await ch.repo.findBatchSummary({ projectId: tenantId, batchRunId });

        expect(summary?.allCompletedAt).toBeNull();
      });
    });
  });

  describe("given every run of the batch reached a terminal status", () => {
    describe("when the batch aggregate is read", () => {
      /** @scenario "A batch is complete when every run is terminal" */
      it("settles every run and carries a completion timestamp", async () => {
        const { batchRunId } = await seedBatch(["SUCCESS", "FAILURE"]);

        const summary = await ch.repo.findBatchSummary({ projectId: tenantId, batchRunId });

        expect(summary?.runningCount).toBe(0);
        expect(summary?.settledCount).toBe(summary?.totalCount);
        expect(summary?.allCompletedAt).not.toBeNull();
      });
    });
  });
});

describe.skipIf(databaseUrl === null)("the batch-scoped run list", () => {
  describe("given runs exist in two different batches", () => {
    describe("when the list is requested with only a batch run id", () => {
      /** @scenario "A batch id alone filters the list" */
      it("returns the batch's runs and no others", async () => {
        const scenarioSetId = `set-only-${nanoid()}`;
        const batchRunId = `batch-only-${nanoid()}`;
        const wantedRunId = `run-only-${nanoid()}`;

        await ch.insertRows([
          makeRunRow({ scenarioSetId, batchRunId, scenarioRunId: wantedRunId }),
          makeRunRow({ scenarioSetId, batchRunId: `batch-other-${nanoid()}` }),
        ]);

        const result = await ch.repo.findRunDataForBatchRun({ projectId: tenantId, batchRunId });

        expect(result.changed).toBe(true);
        if (!result.changed) throw new Error("expected changed");
        expect(result.runs.map((r) => r.scenarioRunId)).toEqual([wantedRunId]);
      });
    });

    describe("when the list is requested with both a batch run id and a scenario set id", () => {
      /** @scenario "A batch id with a scenario set id keeps working" */
      it("returns the batch's runs", async () => {
        const scenarioSetId = `set-both-${nanoid()}`;
        const batchRunId = `batch-both-${nanoid()}`;
        const wantedRunId = `run-both-${nanoid()}`;

        await ch.insertRows([
          makeRunRow({ scenarioSetId, batchRunId, scenarioRunId: wantedRunId }),
          makeRunRow({
            scenarioSetId: `set-elsewhere-${nanoid()}`,
            batchRunId: `batch-elsewhere-${nanoid()}`,
          }),
        ]);

        const result = await ch.repo.findRunDataForBatchRun({
          projectId: tenantId,
          scenarioSetId,
          batchRunId,
        });

        expect(result.changed).toBe(true);
        if (!result.changed) throw new Error("expected changed");
        expect(result.runs.map((r) => r.scenarioRunId)).toEqual([wantedRunId]);
      });
    });
  });

  describe("given a batch holds one run in the default set and one in a named set", () => {
    describe("when the runs are read with the batch id and an empty scenario set id", () => {
      /** @scenario "An empty scenario set id still selects the default set" */
      it("keeps the default set filter instead of dropping it", async () => {
        const batchRunId = `batch-default-${nanoid()}`;
        // The default set holds both storage values: "" from rows written
        // before the set id got its name, and "default" from rows after.
        const legacyDefaultRunId = `run-legacy-default-${nanoid()}`;
        const namedDefaultRunId = `run-named-default-${nanoid()}`;

        await ch.insertRows([
          makeRunRow({ scenarioSetId: "", batchRunId, scenarioRunId: legacyDefaultRunId }),
          makeRunRow({
            scenarioSetId: "default",
            batchRunId,
            scenarioRunId: namedDefaultRunId,
          }),
          makeRunRow({ scenarioSetId: `set-named-${nanoid()}`, batchRunId }),
        ]);

        const result = await ch.repo.findRunDataForBatchRun({
          projectId: tenantId,
          scenarioSetId: "",
          batchRunId,
        });

        expect(result.changed).toBe(true);
        if (!result.changed) throw new Error("expected changed");
        // The two default rows share a CreatedAt, so their order is not
        // decided; only membership is.
        expect(result.runs.map((r) => r.scenarioRunId).toSorted()).toEqual(
          [legacyDefaultRunId, namedDefaultRunId].toSorted(),
        );
      });
    });
  });
});
