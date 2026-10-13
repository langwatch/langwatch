/**
 * Who started a batch, read back off the runs that already load with batch
 * history.
 *
 * @see specs/scenarios/run-actor-on-runs.feature
 */

import { nanoid } from "nanoid";
import { describe, expect, it } from "vitest";

import { SimulationClickHouseRepository } from "../simulation-clickhouse.repository.ts";
import {
  databaseUrl,
  simulationRunRow,
  useSimulationClickHouse,
} from "./simulation-clickhouse-rows.fixture.ts";

const tenantId = `test-run-actor-${nanoid()}`;

/** The reserved namespace of a run started by a person. */
function startedBy(id: string, label: string) {
  return {
    langwatch: {
      targetReferenceId: "agent-1",
      targetType: "http",
      actorId: id,
      actorLabel: label,
    },
  };
}

const ch = useSimulationClickHouse({ tenantId });

describe.skipIf(databaseUrl === null)("who started a batch", () => {
  describe("when every run of the batch names the same person", () => {
    /** @scenario "The batch history reports who started each batch" */
    it("reports that person on the batch in the history page", async () => {
      const scenarioSetId = `set-actor-${nanoid()}`;
      const batchRunId = `batch-actor-${nanoid()}`;
      await ch.insertRows([
        simulationRunRow({
          tenantId,
          scenarioSetId,
          batchRunId,
          metadata: startedBy("user_lena", "user"),
        }),
        simulationRunRow({
          tenantId,
          scenarioSetId,
          batchRunId,
          metadata: startedBy("user_lena", "user"),
        }),
      ]);

      const result = await ch.repo.listBatchHistoryForScenarioSet({
        projectId: tenantId,
        scenarioSetId,
        limit: 10,
      });

      const batch = result.batches.find((b) => b.batchRunId === batchRunId);
      expect(batch?.startedBy).toEqual({ id: "user_lena", label: "user" });
    });

    /** @scenario "The summary of one batch reports who started it" */
    it("reports that person on the summary of that one batch", async () => {
      const scenarioSetId = `set-actor-summary-${nanoid()}`;
      const batchRunId = `batch-actor-summary-${nanoid()}`;
      await ch.insertRows([
        simulationRunRow({
          tenantId,
          scenarioSetId,
          batchRunId,
          metadata: startedBy("user_omar", "cli"),
        }),
      ]);

      const summary = await ch.repo.findBatchSummary({
        projectId: tenantId,
        batchRunId,
      });

      expect(summary?.startedBy).toEqual({ id: "user_omar", label: "cli" });
    });
  });

  describe("when the batch was started with a key that names no person", () => {
    /** @scenario "A batch whose runs record no actor reports none" */
    it("reports no actor in the history page and on the summary", async () => {
      const scenarioSetId = `set-no-actor-${nanoid()}`;
      const batchRunId = `batch-no-actor-${nanoid()}`;
      await ch.insertRows([
        simulationRunRow({
          tenantId,
          scenarioSetId,
          batchRunId,
          metadata: { langwatch: { targetReferenceId: "agent-1", targetType: "http" } },
        }),
      ]);

      const result = await ch.repo.listBatchHistoryForScenarioSet({
        projectId: tenantId,
        scenarioSetId,
        limit: 10,
      });
      const summary = await ch.repo.findBatchSummary({
        projectId: tenantId,
        batchRunId,
      });

      const batch = result.batches.find((b) => b.batchRunId === batchRunId);
      expect(batch?.startedBy).toBeNull();
      expect(summary?.startedBy).toBeNull();
    });

    /** @scenario "A batch whose runs record no actor reports none" */
    it("reports no actor for a batch recorded with no metadata at all", async () => {
      const scenarioSetId = `set-null-actor-${nanoid()}`;
      const batchRunId = `batch-null-actor-${nanoid()}`;
      await ch.insertRows([
        simulationRunRow({
          tenantId,
          scenarioSetId,
          batchRunId,
          metadata: null,
        }),
      ]);

      const result = await ch.repo.listBatchHistoryForScenarioSet({
        projectId: tenantId,
        scenarioSetId,
        limit: 10,
      });
      const summary = await ch.repo.findBatchSummary({
        projectId: tenantId,
        batchRunId,
      });

      const batch = result.batches.find((b) => b.batchRunId === batchRunId);
      expect(batch?.startedBy).toBeNull();
      expect(summary?.startedBy).toBeNull();
    });
  });

  describe("when a run set holds one batch with an actor and one without", () => {
    /** @scenario "The batch history reports who started each batch" */
    it("reports each batch's own actor, or none", async () => {
      const scenarioSetId = `set-mixed-actor-${nanoid()}`;
      const named = `batch-named-${nanoid()}`;
      const unnamed = `batch-unnamed-${nanoid()}`;
      await ch.insertRows([
        simulationRunRow({
          tenantId,
          scenarioSetId,
          batchRunId: named,
          metadata: startedBy("user_lena", "user"),
        }),
        simulationRunRow({
          tenantId,
          scenarioSetId,
          batchRunId: unnamed,
          metadata: null,
        }),
      ]);

      const result = await ch.repo.listBatchHistoryForScenarioSet({
        projectId: tenantId,
        scenarioSetId,
        limit: 10,
      });

      const byId = new Map(result.batches.map((b) => [b.batchRunId, b]));
      expect(byId.get(named)?.startedBy).toEqual({ id: "user_lena", label: "user" });
      expect(byId.get(unnamed)?.startedBy).toBeNull();
    });
  });
});

describe.skipIf(databaseUrl === null)("the cost of reading who started a batch", () => {
  describe("when a page of batch history is read", () => {
    /** @scenario "Reading the actor keeps the run set query bounded to the page" */
    it("reads the actor only in the query already bounded to the page", async () => {
      const scenarioSetId = `set-actor-bounded-${nanoid()}`;
      const batchRunId = `batch-actor-bounded-${nanoid()}`;
      await ch.insertRows([
        simulationRunRow({
          tenantId,
          scenarioSetId,
          batchRunId,
          metadata: startedBy("user_lena", "user"),
        }),
      ]);

      const captured: string[] = [];
      const recordingClient = new Proxy(ch.client, {
        get(target, prop, receiver) {
          if (prop === "query") {
            return (args: { query: string }) => {
              captured.push(args.query);
              return (target.query as typeof target.query).call(target, args);
            };
          }
          return Reflect.get(target, prop, receiver);
        },
      });
      const recordingRepo = SimulationClickHouseRepository.create(async () => recordingClient);

      const result = await recordingRepo.listBatchHistoryForScenarioSet({
        projectId: tenantId,
        scenarioSetId,
        limit: 10,
      });

      expect(result.batches[0]?.startedBy).toEqual({ id: "user_lena", label: "user" });

      const actorQueries = captured.filter((q) => q.includes("AS ActorId"));
      expect(actorQueries).toHaveLength(1);
      expect(actorQueries[0]).toContain("BatchRunId IN ({batchRunIds:");
      expect(actorQueries[0]).toContain("StartedAt >=");

      const wholeSetQueries = captured.filter((q) => q.includes("count(DISTINCT BatchRunId)"));
      expect(wholeSetQueries).toHaveLength(1);
      expect(wholeSetQueries[0]).not.toContain("Metadata");
    });
  });
});
