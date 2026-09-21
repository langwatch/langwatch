/**
 * Who started a batch, read back off the runs that already load with batch
 * history.
 *
 * @see specs/scenarios/run-actor-on-runs.feature
 */

import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createResilientClickHouseClient } from "~/server/clickhouse/managedClient";
import {
  startTestContainers,
  stopTestContainers,
} from "../../../event-sourcing/__tests__/integration/testContainers";
import { SimulationClickHouseRepository } from "../repositories/simulation.clickhouse.repository";

const tenantId = `test-run-actor-${nanoid()}`;
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

let ch: ClickHouseClient;
let repo: SimulationClickHouseRepository;

async function insertRows(rows: ReturnType<typeof makeRunRow>[]) {
  await ch.insert({
    table: "simulation_runs",
    values: rows,
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
}

beforeAll(async () => {
  const containers = await startTestContainers();
  ch = containers.clickHouseClient;
  const resilient = createResilientClickHouseClient({ client: ch });
  repo = new SimulationClickHouseRepository(async () => resilient);
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

describe("who started a batch", () => {
  describe("when every run of the batch names the same person", () => {
    /** @scenario "The batch history reports who started each batch" */
    it("reports that person on the batch in the history page", async () => {
      const scenarioSetId = `set-actor-${nanoid()}`;
      const batchRunId = `batch-actor-${nanoid()}`;
      await insertRows([
        makeRunRow({
          scenarioSetId,
          batchRunId,
          metadata: startedBy("user_lena", "user"),
        }),
        makeRunRow({
          scenarioSetId,
          batchRunId,
          metadata: startedBy("user_lena", "user"),
        }),
      ]);

      const result = await repo.getBatchHistoryForScenarioSet({
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
      await insertRows([
        makeRunRow({
          scenarioSetId,
          batchRunId,
          metadata: startedBy("user_omar", "cli"),
        }),
      ]);

      const summary = await repo.getBatchSummary({
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
      await insertRows([
        makeRunRow({
          scenarioSetId,
          batchRunId,
          metadata: {
            langwatch: { targetReferenceId: "agent-1", targetType: "http" },
          },
        }),
      ]);

      const result = await repo.getBatchHistoryForScenarioSet({
        projectId: tenantId,
        scenarioSetId,
        limit: 10,
      });
      const summary = await repo.getBatchSummary({
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
      await insertRows([
        makeRunRow({ scenarioSetId, batchRunId, metadata: null }),
      ]);

      const result = await repo.getBatchHistoryForScenarioSet({
        projectId: tenantId,
        scenarioSetId,
        limit: 10,
      });
      const summary = await repo.getBatchSummary({
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
      await insertRows([
        makeRunRow({
          scenarioSetId,
          batchRunId: named,
          metadata: startedBy("user_lena", "user"),
        }),
        makeRunRow({ scenarioSetId, batchRunId: unnamed, metadata: null }),
      ]);

      const result = await repo.getBatchHistoryForScenarioSet({
        projectId: tenantId,
        scenarioSetId,
        limit: 10,
      });

      const byId = new Map(result.batches.map((b) => [b.batchRunId, b]));
      expect(byId.get(named)?.startedBy).toEqual({
        id: "user_lena",
        label: "user",
      });
      expect(byId.get(unnamed)?.startedBy).toBeNull();
    });
  });
});

describe("the cost of reading who started a batch", () => {
  describe("when a page of batch history is read", () => {
    /** @scenario "Reading the actor keeps the run set query bounded to the page" */
    it("reads the actor only in the query already bounded to the page", async () => {
      const scenarioSetId = `set-actor-bounded-${nanoid()}`;
      const batchRunId = `batch-actor-bounded-${nanoid()}`;
      await insertRows([
        makeRunRow({
          scenarioSetId,
          batchRunId,
          metadata: startedBy("user_lena", "user"),
        }),
      ]);

      const captured: string[] = [];
      const recordingClient = new Proxy(ch, {
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
      const recordingRepo = new SimulationClickHouseRepository(async () =>
        createResilientClickHouseClient({ client: recordingClient }),
      );

      const result = await recordingRepo.getBatchHistoryForScenarioSet({
        projectId: tenantId,
        scenarioSetId,
        limit: 10,
      });

      expect(result.batches[0]?.startedBy).toEqual({
        id: "user_lena",
        label: "user",
      });

      const actorQueries = captured.filter((q) => q.includes("AS ActorId"));
      expect(actorQueries).toHaveLength(1);
      // The one query that reads the actor is the preview read, which is
      // already bounded to the page's batch ids and their StartedAt window.
      expect(actorQueries[0]).toContain("BatchRunId IN ({batchRunIds:");
      expect(actorQueries[0]).toContain("StartedAt >=");

      // The query that counts the whole set never touches run metadata.
      const wholeSetQueries = captured.filter((q) =>
        q.includes("count(DISTINCT BatchRunId)"),
      );
      expect(wholeSetQueries).toHaveLength(1);
      expect(wholeSetQueries[0]).not.toContain("Metadata");
    });
  });
});
