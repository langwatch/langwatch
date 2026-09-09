/**
 * A test suite's finished runs, as the Test Runs list and its runs sidebar read
 * them: the suite's internal run set, and the batches inside it.
 * @see specs/suites/test-suite-run-plan-reuse.feature
 */

import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SimulationClickHouseRepository } from "../simulation-clickhouse.repository.ts";
import { SimulationWindowedReadPort } from "../../../ports/simulation-windowed-read.port.ts";
import { getSuiteSetId } from "@langwatch/suite-contract";

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

const tenantId = `test-suite-results-${nanoid()}`;
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

integration("a test suite's runs in the results view", () => {
  describe("when a test suite's internal run set holds a finished batch", () => {
    /** @scenario "A test suite run appears in the results view under the test suite's name" */
    it("lists the run plan that run resolved among the internal suite sets", async () => {
      const testSuiteId = `suite-${nanoid(6)}`;
      const setId = getSuiteSetId(testSuiteId);
      await insertRows([
        makeRunRow({ scenarioSetId: setId, batchRunId: `batch-${nanoid(6)}`, metadata: null }),
      ]);

      const summaries = await repo.getInternalSuiteSummaries({ projectId: tenantId });

      const suiteSummary = summaries.find((summary) => summary.scenarioSetId === setId);
      expect(suiteSummary).toBeDefined();
      expect(suiteSummary?.totalCount).toBe(1);
    });

    /** @scenario "A test suite run appears in the results view under the test suite's name" */
    it("shows that batch in the set's run history when the plan is opened", async () => {
      const testSuiteId = `suite-open-${nanoid(6)}`;
      const setId = getSuiteSetId(testSuiteId);
      const batchRunId = `batch-open-${nanoid(6)}`;
      await insertRows([
        makeRunRow({ scenarioSetId: setId, batchRunId, metadata: null }),
        makeRunRow({ scenarioSetId: setId, batchRunId, metadata: null }),
      ]);

      const history = await repo.getBatchHistoryForScenarioSet({
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
      await insertRows([
        makeRunRow({ scenarioSetId: setId, batchRunId: `batch-ext-${nanoid(6)}`, metadata: null }),
      ]);

      const external = await repo.getExternalSetSummaries({ projectId: tenantId });

      expect(external.map((summary) => summary.scenarioSetId)).not.toContain(setId);
    });
  });
});
