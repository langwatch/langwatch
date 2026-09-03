/**
 * The half of the export contract that only exists as SQL.
 *
 * Every scope the dialog offers — date range, scenario, set, project — is a
 * WHERE clause, and archived exclusion happens on the way out of the row
 * mapper. None of that can be observed against a stubbed
 * repository, so this runs against a real ClickHouse: a filter that silently
 * matches nothing looks identical to one that correctly matched nothing, and
 * only real rows tell the two apart.
 *
 * @see specs/scenarios/scenario-run-export.feature
 */

import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { STALL_THRESHOLD_MS } from "../../../index";
import { ScenarioRunStatus } from "@langwatch/scenario-contract";
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

const tenantId = `test-export-sweep-${nanoid()}`;
const otherTenantId = `test-export-sweep-other-${nanoid()}`;
const now = Date.now();
const DAY_MS = 24 * 60 * 60 * 1000;

function makeInsertRow(overrides: Record<string, unknown> = {}) {
  const startedAt = new Date(now - 5000);
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
    Description: null,
    Metadata: null,
    "Messages.Id": [],
    "Messages.Role": [],
    "Messages.Content": [],
    "Messages.TraceId": [],
    "Messages.Rest": [],
    TraceIds: [],
    Verdict: "success",
    Reasoning: "All good",
    MetCriteria: ["criterion-1"],
    UnmetCriteria: [],
    Error: null,
    DurationMs: "1500",
    StartedAt: startedAt,
    CreatedAt: startedAt,
    UpdatedAt: new Date(now),
    FinishedAt: new Date(now),
    ArchivedAt: null,
    LastSnapshotOccurredAt: new Date(0),
    ...overrides,
  };
}

let client: ClickHouseClient | undefined;
let repo: SimulationClickHouseRepository;

async function insertRows(rows: ReturnType<typeof makeInsertRow>[]) {
  if (!client) throw new Error("ClickHouse integration environment is unavailable");
  await client.insert({
    table: "simulation_runs",
    values: rows,
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
}

/** Sweeps to exhaustion the way the service does, so cursor handling is exercised too. */
async function sweep(
  params: Parameters<SimulationClickHouseRepository["findRunsForExport"]>[0],
) {
  const collected = [];
  let cursor: string | undefined;
  do {
    const page = await repo.findRunsForExport({
      ...params,
      ...(cursor ? { cursor } : {}),
    });
    collected.push(...page.runs);
    cursor = page.hasMore ? page.nextCursor : undefined;
  } while (cursor);
  return collected;
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
    query: `ALTER TABLE simulation_runs DELETE WHERE TenantId IN ({tenantId:String}, {otherTenantId:String})`,
    query_params: { tenantId, otherTenantId },
    clickhouse_settings: { mutations_sync: "2" },
  });
  await client.close();
  client = undefined;
});

integration("scenario run export sweep (integration)", () => {
  describe("given runs spread across projects, sets, scenarios and dates", () => {
    const recentScenarioId = `scenario-recent-${nanoid()}`;
    const oldScenarioId = `scenario-old-${nanoid()}`;
    const targetSetId = `set-target-${nanoid()}`;
    const otherSetId = `set-other-${nanoid()}`;
    const archivedRunId = `run-archived-${nanoid()}`;
    const recentRunId = `run-recent-${nanoid()}`;
    const oldRunId = `run-old-${nanoid()}`;
    const otherSetRunId = `run-other-set-${nanoid()}`;
    const otherProjectRunId = `run-other-project-${nanoid()}`;

    beforeAll(async () => {
      const recent = new Date(now - DAY_MS);
      const old = new Date(now - 45 * DAY_MS);

      await insertRows([
        makeInsertRow({
          ScenarioRunId: recentRunId,
          ScenarioId: recentScenarioId,
          ScenarioSetId: targetSetId,
          StartedAt: recent,
          CreatedAt: recent,
          UpdatedAt: recent,
          FinishedAt: recent,
        }),
        makeInsertRow({
          ScenarioRunId: oldRunId,
          ScenarioId: oldScenarioId,
          ScenarioSetId: targetSetId,
          StartedAt: old,
          CreatedAt: old,
          UpdatedAt: old,
          FinishedAt: old,
        }),
        makeInsertRow({
          ScenarioRunId: otherSetRunId,
          ScenarioId: recentScenarioId,
          ScenarioSetId: otherSetId,
          StartedAt: recent,
          CreatedAt: recent,
          UpdatedAt: recent,
          FinishedAt: recent,
        }),
        makeInsertRow({
          ScenarioRunId: archivedRunId,
          ScenarioId: recentScenarioId,
          ScenarioSetId: targetSetId,
          StartedAt: recent,
          CreatedAt: recent,
          UpdatedAt: recent,
          FinishedAt: recent,
          ArchivedAt: recent,
        }),
        makeInsertRow({
          TenantId: otherTenantId,
          ScenarioRunId: otherProjectRunId,
          ScenarioId: recentScenarioId,
          ScenarioSetId: targetSetId,
          StartedAt: recent,
          CreatedAt: recent,
          UpdatedAt: recent,
          FinishedAt: recent,
        }),
      ]);
    }, 30_000);

    /** @scenario Export honours the selected date range */
    it("includes only runs started inside the range", async () => {
      const runs = await sweep({
        projectId: tenantId,
        startDate: now - 30 * DAY_MS,
        endDate: now,
        limit: 100,
      });

      const ids = runs.map((run) => run.scenarioRunId);
      expect(ids).toContain(recentRunId);
      expect(ids).not.toContain(oldRunId);
    });

    /** @scenario Export honours the scenario filter */
    it("includes only runs of the chosen scenario", async () => {
      const runs = await sweep({
        projectId: tenantId,
        scenarioId: oldScenarioId,
        limit: 100,
      });

      expect(runs.map((run) => run.scenarioRunId)).toEqual([oldRunId]);
    });

    /** @scenario Export from a scenario set is scoped to that set */
    it("includes only runs belonging to the chosen set", async () => {
      const runs = await sweep({
        projectId: tenantId,
        scenarioSetId: otherSetId,
        limit: 100,
      });

      expect(runs.map((run) => run.scenarioRunId)).toEqual([otherSetRunId]);
    });

    /** @scenario Archived runs are excluded */
    it("leaves archived runs out of both the sweep and its count", async () => {
      const runs = await sweep({ projectId: tenantId, limit: 100 });
      expect(runs.map((run) => run.scenarioRunId)).not.toContain(archivedRunId);

      // The count feeds X-Total-Runs and therefore the progress denominator, so
      // it has to agree with the sweep or the bar never reaches its total.
      const total = await repo.countRunsForExport({ projectId: tenantId });
      expect(total).toBe(runs.length);
    });

    /**
     * TenantId is the only id unique across projects — ScenarioRunId is not —
     * so this is the predicate that stops one customer's export containing
     * another's transcripts.
     */
    /** @scenario Export is scoped to my own project */
    it("never returns another project's runs", async () => {
      const runs = await sweep({ projectId: tenantId, limit: 100 });
      expect(runs.map((run) => run.scenarioRunId)).not.toContain(
        otherProjectRunId,
      );

      const otherRuns = await sweep({ projectId: otherTenantId, limit: 100 });
      expect(otherRuns.map((run) => run.scenarioRunId)).toEqual([
        otherProjectRunId,
      ]);
    });
  });

  describe("given a run whose StartedAt moved between versions", () => {
    /**
     * The projection opens a run with StartedAt null — persisted as CreatedAt —
     * and only sets the real value when the started event lands. So a run can
     * have an early provisional timestamp inside the window and a corrected one
     * outside it.
     *
     * Deduplicating with the date filter inside the subquery picks the newest
     * version *within the range*, which here is the stale one: it would export
     * a run as IN_PROGRESS with no messages long after it finished. The latest
     * version has to be chosen first, and the range applied to that.
     */
    it("judges the range on the latest version, not the newest in-range one", async () => {
      const runId = `run-moved-${nanoid()}`;
      const setId = `set-moved-${nanoid()}`;
      // Both rows are versions of ONE run, so every field of the dedup key —
      // tenant, set, batch, run — has to match. A fresh BatchRunId would make
      // them two unrelated runs and the test would prove nothing.
      const batchRunId = `batch-moved-${nanoid()}`;
      const scenarioId = `scenario-moved-${nanoid()}`;
      const provisional = new Date(now - 10 * DAY_MS);
      const corrected = new Date(now - 40 * DAY_MS);

      await insertRows([
        // Written first: no started event yet, so StartedAt fell back to
        // CreatedAt and lands inside a "last 30 days" window.
        makeInsertRow({
          ScenarioRunId: runId,
          ScenarioSetId: setId,
          BatchRunId: batchRunId,
          ScenarioId: scenarioId,
          Status: "IN_PROGRESS",
          StartedAt: provisional,
          CreatedAt: provisional,
          UpdatedAt: provisional,
          FinishedAt: null,
        }),
        // The started event arrived and corrected StartedAt to its real value,
        // which is outside that window.
        makeInsertRow({
          ScenarioRunId: runId,
          ScenarioSetId: setId,
          BatchRunId: batchRunId,
          ScenarioId: scenarioId,
          Status: "SUCCESS",
          StartedAt: corrected,
          CreatedAt: provisional,
          UpdatedAt: new Date(now),
          FinishedAt: new Date(now - 39 * DAY_MS),
        }),
      ]);

      const inWindow = await sweep({
        projectId: tenantId,
        scenarioSetId: setId,
        startDate: now - 30 * DAY_MS,
        endDate: now,
        limit: 100,
      });

      // The run's real StartedAt is 40 days ago, so it is out of range —
      // rather than in range wearing its stale IN_PROGRESS snapshot.
      expect(inWindow.map((run) => run.scenarioRunId)).not.toContain(runId);

      const widerWindow = await sweep({
        projectId: tenantId,
        scenarioSetId: setId,
        startDate: now - 60 * DAY_MS,
        endDate: now,
        limit: 100,
      });
      const found = widerWindow.find((run) => run.scenarioRunId === runId);
      expect(found).toBeDefined();
      expect(found!.status).toBe(ScenarioRunStatus.SUCCESS);
    });
  });

  describe("given a run that stopped emitting events without finishing", () => {
    /**
     * There is no read-time STALLED derivation anymore: an unfinished run
     * reads as IN_PROGRESS no matter how quiet it has been, on screen and in
     * the export alike. A genuinely stalled run reaches ERROR via the
     * process-manager stall watchdog's terminal event.
     */
    /** @scenario A run quiet past the stall threshold exports as in progress */
    it("exports it as in progress, the same as the run history shows it", async () => {
      const quietRunId = `run-quiet-${nanoid()}`;
      const lastEvent = new Date(now - STALL_THRESHOLD_MS - 60_000);

      await insertRows([
        makeInsertRow({
          ScenarioRunId: quietRunId,
          ScenarioSetId: `set-quiet-${nanoid()}`,
          Status: "IN_PROGRESS",
          Verdict: null,
          MetCriteria: [],
          UnmetCriteria: [],
          Reasoning: null,
          StartedAt: lastEvent,
          CreatedAt: lastEvent,
          UpdatedAt: lastEvent,
          FinishedAt: null,
        }),
      ]);

      const runs = await sweep({ projectId: tenantId, limit: 100 });
      const quiet = runs.find((run) => run.scenarioRunId === quietRunId);

      expect(quiet).toBeDefined();
      expect(quiet!.status).toBe(ScenarioRunStatus.IN_PROGRESS);
    });
  });
});
