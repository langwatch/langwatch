/**
 * Migration 00084: swap `governance_kpis` from
 * `ReplacingMergeTree(LastEventOccurredAt)` to `ReplacingMergeTree(CreatedAt)`.
 *
 * `LastEventOccurredAt` moves BACKWARD — the fold takes
 * `min(occurredAt, span.startTimeUnixMs)`, so a later flush that folded in an
 * earlier-starting span carries a LOWER value than the flush before it. The
 * engine keeps the row with the HIGHEST version at merge time, so merges kept
 * the stale, lower-spend row and discarded the correct cumulative one. Reads
 * are plain `sum(SpendUsd)` with no `FINAL` and no `argMax`, so nothing
 * compensated.
 *
 * The swap is a copy-and-EXCHANGE. It is only lossless if the KPI writer is
 * QUIESCED while it runs: the writer inserts with async_insert = 1,
 * wait_for_async_insert = 0 and is event-driven per trace (it never re-emits),
 * so a contribution written mid-migration lands only in the pre-swap table and
 * is lost for good when that table is dropped. No in-migration reconciliation
 * can close that window — an async buffer can always flush between the last
 * read and the DROP — so the migration does not try; it depends on the writer
 * being stopped, and GUARDS that precondition (step 0) by aborting if
 * `governance_kpis` shows a write in the last 60s. These tests exercise both
 * the quiesced happy path and that guard.
 *
 * On its OWN endpoint, not the shared migrated one. Staging the pre-upgrade
 * state means dropping and recreating `governance_kpis`, and the shared
 * database is read by other suites — `spendSpikeAnomalyEvaluator` seeds and
 * queries that exact table. `withReplayLock` orders replays against each
 * other but not against plain readers, so on the shared endpoint a neighbour
 * could read the table during the window where it does not exist. An isolated
 * database removes the question rather than narrowing it.
 *
 * @see https://github.com/langwatch/langwatch-saas/issues/1089
 */
import { type ClickHouseClient, createClient } from "@clickhouse/client";
import { generate } from "@langwatch/ksuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestClickHouseEndpoints } from "~/test-utils/clickhouseTestEndpoints";
import { replayGooseMigrationUp } from "./migrationReplay";

const CREATE_MIGRATION = "00031_create_governance_kpis.sql";
const VERSION_COLUMN_MIGRATION = "00084_governance_kpis_version_column_fix.sql";

const tenantId = `test-kpis-${generate("tenant").toString()}`;
const sourceId = "src-1";
const hourBucket = "2026-08-01 10:00:00";

let ch: ClickHouseClient;

interface KpiRow {
  TraceId: string;
  SpendUsd: number;
  PromptTokens: number;
  CompletionTokens: number;
  CreatedAt: string;
  LastEventOccurredAt: string;
}

async function insertKpiRows(rows: KpiRow[]): Promise<void> {
  await ch.insert({
    table: "governance_kpis",
    values: rows.map((row) => ({
      TenantId: tenantId,
      SourceId: sourceId,
      HourBucket: hourBucket,
      SourceType: "api_key",
      ...row,
    })),
    format: "JSONEachRow",
  });
}

/**
 * Inserts a row the way the live writer would: no explicit `CreatedAt`, so the
 * table's `DEFAULT now64(3)` stamps it at the current wall clock. This is what
 * the step-0 guard is meant to see — a write that just happened — and it is
 * the only thing in the suite dated to "now" rather than the fixed
 * 2026-08-01 staging timestamps.
 */
async function insertLiveKpiRow(traceId: string): Promise<void> {
  await ch.insert({
    table: "governance_kpis",
    values: [
      {
        TenantId: tenantId,
        SourceId: sourceId,
        HourBucket: hourBucket,
        SourceType: "api_key",
        TraceId: traceId,
        SpendUsd: 0.5,
        PromptTokens: 100,
        CompletionTokens: 50,
        // CreatedAt intentionally omitted -> DEFAULT now64(3).
        LastEventOccurredAt: "2026-08-01 10:05:00.000",
      },
    ],
    format: "JSONEachRow",
  });
}

async function readKpiRows(): Promise<
  { TraceId: string; SpendUsd: number; PromptTokens: number }[]
> {
  const result = await ch.query({
    query: `
      SELECT TraceId, SpendUsd, PromptTokens
      FROM governance_kpis
      WHERE TenantId = {tenantId:String}
      ORDER BY TraceId
    `,
    query_params: { tenantId },
    format: "JSONEachRow",
  });
  return result.json();
}

async function versionColumnOf(table: string): Promise<string> {
  const result = await ch.query({
    query: `SELECT engine_full FROM system.tables WHERE database = currentDatabase() AND name = {table:String}`,
    query_params: { table },
    format: "JSONEachRow",
  });
  const [row] = await result.json<{ engine_full: string }>();
  return row?.engine_full ?? "";
}

/**
 * Puts `governance_kpis` in the shape 00031 leaves it: the pre-upgrade engine,
 * empty. 00084 is what is under test, so every case has to start from before
 * it ran — and each one starts from a clean table so the cases cannot read each
 * other's rows.
 */
async function stageThePreUpgradeTable(): Promise<void> {
  await ch.command({ query: "DROP TABLE IF EXISTS governance_kpis" });
  await replayGooseMigrationUp({ client: ch, fileName: CREATE_MIGRATION });
}

beforeAll(async () => {
  const [endpoint] = await startTestClickHouseEndpoints({
    suite: "governance-kpis-version-column",
    names: ["migration"],
  });
  ch = createClient({ url: endpoint!.url });
}, 120_000);

afterAll(async () => {
  // Nothing to restore: the endpoint is this suite's own database, so the
  // schema it is left in is nobody else's problem.
  await ch?.close();
});

describe("governance_kpis version column migration", () => {
  describe("given the writer is quiesced and the pre-upgrade table holds rows", () => {
    beforeAll(async () => {
      await stageThePreUpgradeTable();
      // Staging timestamps are ~weeks before the test clock, so they never
      // trip the step-0 recent-write guard.
      await insertKpiRows([
        {
          TraceId: "trace-a",
          SpendUsd: 0.25,
          PromptTokens: 100,
          CompletionTokens: 50,
          CreatedAt: "2026-08-01 10:00:01.000",
          LastEventOccurredAt: "2026-08-01 10:05:00.000",
        },
        {
          TraceId: "trace-b",
          SpendUsd: 1.75,
          PromptTokens: 300,
          CompletionTokens: 150,
          CreatedAt: "2026-08-01 10:00:02.000",
          LastEventOccurredAt: "2026-08-01 10:06:00.000",
        },
      ]);

      // No afterStatement hook: the writer is stopped, nothing races the copy.
      await replayGooseMigrationUp({
        client: ch,
        fileName: VERSION_COLUMN_MIGRATION,
      });
    }, 120_000);

    it("preserves every row through the swap", async () => {
      const rows = await readKpiRows();

      expect(rows.map((row) => row.TraceId)).toEqual(["trace-a", "trace-b"]);
      expect(rows.map((row) => row.SpendUsd)).toEqual([0.25, 1.75]);
    });

    it("versions the rebuilt table by CreatedAt", async () => {
      expect(await versionColumnOf("governance_kpis")).toContain(
        "ReplacingMergeTree(CreatedAt)",
      );
    });

    it("leaves no scratch table behind", async () => {
      expect(await versionColumnOf("governance_kpis_v2")).toBe("");
    });
  });

  describe("given the migration is applied a second time", () => {
    beforeAll(async () => {
      await replayGooseMigrationUp({
        client: ch,
        fileName: VERSION_COLUMN_MIGRATION,
      });
    }, 120_000);

    it("converges on the same rows rather than failing", async () => {
      const rows = await readKpiRows();

      expect(rows.map((row) => row.TraceId)).toEqual(["trace-a", "trace-b"]);
      expect(await versionColumnOf("governance_kpis")).toContain(
        "ReplacingMergeTree(CreatedAt)",
      );
    });
  });

  describe("given a trace is re-folded with a LastEventOccurredAt that moved backward", () => {
    beforeAll(async () => {
      await insertKpiRows([
        {
          TraceId: "trace-refolded",
          SpendUsd: 0.5,
          PromptTokens: 100,
          CompletionTokens: 50,
          CreatedAt: "2026-08-01 10:00:01.000",
          LastEventOccurredAt: "2026-08-01 10:05:00.000",
        },
      ]);
      await insertKpiRows([
        {
          TraceId: "trace-refolded",
          // Cumulative totals, written later, but carrying an EARLIER
          // LastEventOccurredAt because an earlier-starting span folded in.
          SpendUsd: 1.5,
          PromptTokens: 300,
          CompletionTokens: 150,
          CreatedAt: "2026-08-01 10:00:02.000",
          LastEventOccurredAt: "2026-08-01 09:55:00.000",
        },
      ]);
      await ch.command({ query: "OPTIMIZE TABLE governance_kpis FINAL" });
    }, 120_000);

    it("keeps the cumulative totals after merge", async () => {
      const rows = await readKpiRows();
      const refolded = rows.filter((row) => row.TraceId === "trace-refolded");

      expect(refolded).toHaveLength(1);
      expect(refolded[0]!.SpendUsd).toBe(1.5);
      expect(refolded[0]!.PromptTokens).toBe(300);
    });
  });

  describe("given the writer was NOT quiesced (a write landed within the guard window)", () => {
    /**
     * The step-0 backstop. If an operator applies this without stopping the
     * `workers` deployment first, the live writer is still inserting and the
     * copy-and-swap would drop whatever it wrote during the window. The guard
     * turns that silent loss into a loud, no-op failure: it aborts BEFORE any
     * DDL, so the table is left exactly as it was.
     */
    let rejection: unknown;

    beforeAll(async () => {
      await stageThePreUpgradeTable();
      // A recent write (DEFAULT now64(3)) — the thing the guard exists to see.
      await insertLiveKpiRow("trace-live");

      rejection = await replayGooseMigrationUp({
        client: ch,
        fileName: VERSION_COLUMN_MIGRATION,
      }).then(
        () => undefined,
        (error: unknown) => error,
      );
    }, 120_000);

    it("aborts the migration instead of swapping under a live writer", () => {
      expect(rejection).toBeInstanceOf(Error);
      expect(String(rejection)).toMatch(/quiesce|workers|recent write/i);
    });

    it("leaves the pre-upgrade table untouched", async () => {
      // Guard runs first, so the version column never changed and no scratch
      // table was created.
      expect(await versionColumnOf("governance_kpis")).toContain(
        "ReplacingMergeTree(LastEventOccurredAt)",
      );
      expect(await versionColumnOf("governance_kpis_v2")).toBe("");
    });
  });
});
