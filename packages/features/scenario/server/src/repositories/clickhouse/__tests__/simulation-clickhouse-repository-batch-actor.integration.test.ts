/**
 * Who started a batch, read back off the runs that already load with batch
 * history.
 *
 * @see specs/scenarios/run-actor-on-runs.feature
 */

import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SimulationClickHouseRepository } from "../simulation-clickhouse.repository";
import { SimulationWindowedReadPort } from "../../../ports/simulation-windowed-read.port";

/** Derives the real [hint-window, hint+window] fragment from the hint the repository computes. */
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

const integration = describe.skipIf(databaseUrl === null);

beforeAll(() => {
  if (!databaseUrl) return;
  client = createClient({
    url: databaseUrl,
    clickhouse_settings: { date_time_input_format: "best_effort" },
  });
  repo = SimulationClickHouseRepository.create(async () => client!, new HintWindowedRead());
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

integration("who started a batch", () => {
  describe("when every run of the batch names the same person", () => {
    /** @scenario "The batch history reports who started each batch" */
    it("reports that person on the batch in the history page", async () => {
      const scenarioSetId = `set-actor-${nanoid()}`;
      const batchRunId = `batch-actor-${nanoid()}`;
      await insertRows([
        makeRunRow({ scenarioSetId, batchRunId, metadata: startedBy("user_lena", "user") }),
        makeRunRow({ scenarioSetId, batchRunId, metadata: startedBy("user_lena", "user") }),
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
        makeRunRow({ scenarioSetId, batchRunId, metadata: startedBy("user_omar", "cli") }),
      ]);

      const summary = await repo.tryGetBatchSummary({
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
          metadata: { langwatch: { targetReferenceId: "agent-1", targetType: "http" } },
        }),
      ]);

      const result = await repo.getBatchHistoryForScenarioSet({
        projectId: tenantId,
        scenarioSetId,
        limit: 10,
      });
      const summary = await repo.tryGetBatchSummary({
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
      await insertRows([makeRunRow({ scenarioSetId, batchRunId, metadata: null })]);

      const result = await repo.getBatchHistoryForScenarioSet({
        projectId: tenantId,
        scenarioSetId,
        limit: 10,
      });
      const summary = await repo.tryGetBatchSummary({
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
        makeRunRow({ scenarioSetId, batchRunId: named, metadata: startedBy("user_lena", "user") }),
        makeRunRow({ scenarioSetId, batchRunId: unnamed, metadata: null }),
      ]);

      const result = await repo.getBatchHistoryForScenarioSet({
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

integration("the cost of reading who started a batch", () => {
  describe("when a page of batch history is read", () => {
    /** @scenario "Reading the actor keeps the run set query bounded to the page" */
    it("reads the actor only in the query already bounded to the page", async () => {
      const scenarioSetId = `set-actor-bounded-${nanoid()}`;
      const batchRunId = `batch-actor-bounded-${nanoid()}`;
      await insertRows([
        makeRunRow({ scenarioSetId, batchRunId, metadata: startedBy("user_lena", "user") }),
      ]);

      const captured: string[] = [];
      const recordingClient = new Proxy(client!, {
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
      const recordingRepo = SimulationClickHouseRepository.create(
        async () => recordingClient,
        new HintWindowedRead(),
      );

      const result = await recordingRepo.getBatchHistoryForScenarioSet({
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
