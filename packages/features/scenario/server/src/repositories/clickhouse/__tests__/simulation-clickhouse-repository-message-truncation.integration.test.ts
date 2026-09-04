/**
 * Message truncation on the set-level and batch-scoped run reads: the
 * trimmed projection keeps the first six messages, and `include=messages`
 * (or a batch-scoped read, which always carries whole conversations) turns
 * that off.
 *
 * @see specs/scenarios/simulation-runs-api.feature
 */

import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SimulationClickHouseRepository } from "../simulation-clickhouse.repository";
import { SimulationWindowedReadPort } from "../../../ports/simulation-windowed-read.port";

const configuredClickHouseUrl = process.env.TEST_CLICKHOUSE_URL ?? process.env.CI_CLICKHOUSE_URL;
const databaseUrl = configuredClickHouseUrl ? new URL(configuredClickHouseUrl) : null;
if (databaseUrl && !process.env.TEST_CLICKHOUSE_URL) {
  databaseUrl.pathname = "/test_langwatch";
}

const tenantId = `test-sim-trunc-${nanoid()}`;
const now = Date.now();

/** Ten messages: four more than the trimmed projection keeps. */
function longConversation() {
  const count = 10;
  return {
    "Messages.Id": Array.from({ length: count }, (_, i) => `msg-${i}`),
    "Messages.Role": Array.from({ length: count }, (_, i) => (i % 2 === 0 ? "user" : "assistant")),
    "Messages.Content": Array.from({ length: count }, (_, i) => `turn ${i}`),
    "Messages.TraceId": Array.from({ length: count }, () => ""),
    "Messages.Rest": Array.from({ length: count }, () => "{}"),
  };
}

function makeInsertRow(overrides: Record<string, unknown> = {}) {
  return {
    ProjectionId: `proj-${nanoid()}`,
    TenantId: tenantId,
    ScenarioRunId: `run-${nanoid()}`,
    ScenarioId: `scenario-${nanoid()}`,
    BatchRunId: `batch-${nanoid()}`,
    ScenarioSetId: `set-${nanoid()}`,
    Version: "v1",
    Status: "SUCCESS",
    Name: "Test run",
    Description: "A test description",
    Metadata: null,
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
    StartedAt: new Date(now - 5000),
    CreatedAt: new Date(now - 5000),
    UpdatedAt: new Date(now),
    FinishedAt: new Date(now),
    ArchivedAt: null,
    LastSnapshotOccurredAt: new Date(0),
    ...overrides,
  };
}

/** Same window strategy as `SimulationWindowedReadPort`'s production adapter, minus caching. */
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

let client: ClickHouseClient | undefined;
let repo: SimulationClickHouseRepository;

async function insertRow(row: ReturnType<typeof makeInsertRow>) {
  if (!client) throw new Error("ClickHouse integration environment is unavailable");
  await client.insert({
    table: "simulation_runs",
    values: [row],
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

integration("getRunDataForScenarioSet() message truncation", () => {
  describe("when a run holds more messages than the list keeps", () => {
    /** @scenario "A set-level list marks a run whose messages were trimmed" */
    it("returns the first 6 and reports the trim", async () => {
      const scenarioSetId = `set-trunc-${nanoid()}`;

      await insertRow(
        makeInsertRow({
          ScenarioRunId: `run-trunc-${nanoid()}`,
          ScenarioSetId: scenarioSetId,
          ...longConversation(),
        }),
      );

      const result = await repo.getRunDataForScenarioSet({
        projectId: tenantId,
        scenarioSetId,
        limit: 10,
      });

      expect(result.runs).toHaveLength(1);
      const run = result.runs[0]!;
      expect(run.messages).toHaveLength(6);
      expect(run.messagesTruncated).toBe(true);
    });

    /** @scenario "include=messages returns every message on a set-level list" */
    it("returns every message when the caller includes them", async () => {
      const scenarioSetId = `set-full-${nanoid()}`;

      await insertRow(
        makeInsertRow({
          ScenarioRunId: `run-full-${nanoid()}`,
          ScenarioSetId: scenarioSetId,
          ...longConversation(),
        }),
      );

      const result = await repo.getRunDataForScenarioSet({
        projectId: tenantId,
        scenarioSetId,
        limit: 10,
        shouldIncludeMessages: true,
      });

      expect(result.runs).toHaveLength(1);
      const run = result.runs[0]!;
      expect(run.messages).toHaveLength(10);
      expect(run.messagesTruncated).toBe(false);
    });
  });

  describe("when a run holds no more messages than the list keeps", () => {
    /** @scenario "A run within the message limit is not marked as truncated" */
    it("returns them all and reports no trim", async () => {
      const scenarioSetId = `set-short-${nanoid()}`;

      await insertRow(
        makeInsertRow({
          ScenarioRunId: `run-short-${nanoid()}`,
          ScenarioSetId: scenarioSetId,
        }),
      );

      const result = await repo.getRunDataForScenarioSet({
        projectId: tenantId,
        scenarioSetId,
        limit: 10,
      });

      expect(result.runs).toHaveLength(1);
      const run = result.runs[0]!;
      expect(run.messages).toHaveLength(1);
      expect(run.messagesTruncated).toBe(false);
    });
  });

  describe("when the runs are read through the batch-scoped query", () => {
    /** @scenario "A batch-scoped list is unchanged by the include parameter" */
    it("carries whole conversations without an include parameter", async () => {
      const batchRunId = `batch-full-${nanoid()}`;

      await insertRow(
        makeInsertRow({
          ScenarioRunId: `run-batch-full-${nanoid()}`,
          BatchRunId: batchRunId,
          ...longConversation(),
        }),
      );

      const result = await repo.getRunDataForBatchRun({
        projectId: tenantId,
        batchRunId,
      });

      const runs = "runs" in result ? result.runs : [];
      expect(runs).toHaveLength(1);
      expect(runs[0]!.messages).toHaveLength(10);
      expect(runs[0]!.messagesTruncated).toBe(false);
    });
  });
});
