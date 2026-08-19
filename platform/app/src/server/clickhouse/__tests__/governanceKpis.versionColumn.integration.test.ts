/**
 * Migration 00083: swap `governance_kpis` from
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
 * These tests run the real migration file against a real `governance_kpis`,
 * staged into its pre-upgrade state, because the two things that can actually
 * break are properties of the swap procedure and not of ClickHouse:
 *   - the copy reads a snapshot, so a write arriving mid-migration must still
 *     survive (the reconciliation pass),
 *   - the runner may re-apply a partially executed file, so a second run must
 *     converge rather than wedge.
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
const VERSION_COLUMN_MIGRATION = "00083_governance_kpis_version_column_fix.sql";

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
 * empty. 00083 is what is under test, so every case has to start from before
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
  describe("given the pre-upgrade table holds rows and a write lands mid-migration", () => {
    /**
     * Whether the injected write actually happened. Without this the whole
     * test passes vacuously if the copy statement is ever renamed or
     * reordered — the hook would simply never fire and the assertion below
     * would be checking a row nobody raced.
     */
    let injectedDuringCopy = false;

    beforeAll(async () => {
      injectedDuringCopy = false;
      await stageThePreUpgradeTable();

      await insertKpiRows([
        {
          TraceId: "trace-copied",
          SpendUsd: 0.25,
          PromptTokens: 100,
          CompletionTokens: 50,
          CreatedAt: "2026-08-01 10:00:01.000",
          LastEventOccurredAt: "2026-08-01 10:05:00.000",
        },
      ]);

      await replayGooseMigrationUp({
        client: ch,
        fileName: VERSION_COLUMN_MIGRATION,
        afterStatement: async ({ statement }) => {
          // The copy is the statement that opens the loss window: everything
          // written from here until the swap lands only in the pre-swap table.
          if (!/INSERT INTO\s+\S*governance_kpis_v2/i.test(statement)) return;
          injectedDuringCopy = true;
          await insertKpiRows([
            {
              TraceId: "trace-raced-the-copy",
              SpendUsd: 0.75,
              PromptTokens: 300,
              CompletionTokens: 150,
              CreatedAt: "2026-08-01 10:00:02.000",
              LastEventOccurredAt: "2026-08-01 09:55:00.000",
            },
          ]);
        },
      });
    }, 120_000);

    it("keeps both the copied row and the one that raced the copy", async () => {
      expect(injectedDuringCopy).toBe(true);

      const rows = await readKpiRows();

      expect(rows.map((row) => row.TraceId)).toEqual([
        "trace-copied",
        "trace-raced-the-copy",
      ]);
      expect(rows.map((row) => row.SpendUsd)).toEqual([0.25, 0.75]);
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

      expect(rows.map((row) => row.TraceId)).toEqual([
        "trace-copied",
        "trace-raced-the-copy",
      ]);
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
  describe("given a previous run died after the swap, with a write that landed during the copy", () => {
    /**
     * The loss window a naive re-apply reopens: a write that lands AFTER the
     * snapshot copy exists only in the pre-swap table, which the exchange
     * moves under the scratch name. If the runner then dies before
     * reconciliation, the first draft's unconditional `DROP` at the top of the
     * re-apply would discard that write for good. The `trace-before-the-crash`
     * row (copied into the snapshot) survives either way; `trace-stranded-by-
     * the-crash` (raced the copy, then stranded by the crash) is the one that
     * only survives because the re-apply recovers the scratch before dropping
     * it. Without both flags below the test could pass vacuously — the copy
     * hook or the crash hook silently never firing.
     */
    let crashedAfterExchange = false;
    let racedAfterCopy = false;

    beforeAll(async () => {
      await stageThePreUpgradeTable();
      await insertKpiRows([
        {
          TraceId: "trace-before-the-crash",
          SpendUsd: 2,
          PromptTokens: 10,
          CompletionTokens: 5,
          CreatedAt: "2026-08-01 10:00:03.000",
          LastEventOccurredAt: "2026-08-01 10:06:00.000",
        },
      ]);

      await replayGooseMigrationUp({
        client: ch,
        fileName: VERSION_COLUMN_MIGRATION,
        afterStatement: async ({ statement }) => {
          // A write landing after the copy is absent from the rebuilt table
          // and lives only in the pre-swap one.
          if (/INSERT INTO\s+\S*governance_kpis_v2/i.test(statement)) {
            racedAfterCopy = true;
            await insertKpiRows([
              {
                TraceId: "trace-stranded-by-the-crash",
                SpendUsd: 0.9,
                PromptTokens: 40,
                CompletionTokens: 20,
                CreatedAt: "2026-08-01 10:00:04.000",
                LastEventOccurredAt: "2026-08-01 10:07:00.000",
              },
            ]);
            return;
          }
          // The runner then dies after the exchange but before step 7, the
          // window where that write exists only under the scratch name.
          if (/EXCHANGE TABLES/i.test(statement)) {
            crashedAfterExchange = true;
            throw new Error("simulated runner crash after the swap");
          }
        },
      }).catch(() => undefined);

      await replayGooseMigrationUp({
        client: ch,
        fileName: VERSION_COLUMN_MIGRATION,
      });
    }, 120_000);

    it("recovers the stranded write on the rerun instead of dropping it", async () => {
      expect(racedAfterCopy).toBe(true);
      expect(crashedAfterExchange).toBe(true);

      const rows = await readKpiRows();

      expect(rows.map((row) => row.TraceId)).toEqual([
        "trace-before-the-crash",
        "trace-stranded-by-the-crash",
      ]);
      expect(rows.map((row) => row.SpendUsd)).toEqual([2, 0.9]);
      expect(await versionColumnOf("governance_kpis")).toContain(
        "ReplacingMergeTree(CreatedAt)",
      );
    });
  });

  describe("given a later cumulative row for an already-copied trace races the copy", () => {
    /**
     * The accumulating-counter path: a trace already in the snapshot gets a
     * newer cumulative row during the copy window. Reconciliation carries it
     * over as a second part sharing the ORDER BY key, and the engine collapses
     * it to the highest CreatedAt on merge — the same convergence a
     * steady-state re-write of that trace produces. Reads are plain
     * `sum(SpendUsd)` with no FINAL, so between merges the sum shows both
     * parts; that transient is a property of the read path (identical with or
     * without this migration), so the assertion is the merged result, taken
     * after an explicit OPTIMIZE FINAL rather than racing a background merge.
     */
    let injectedDuringCopy = false;

    beforeAll(async () => {
      await stageThePreUpgradeTable();
      await insertKpiRows([
        {
          TraceId: "trace-accumulating",
          SpendUsd: 0.25,
          PromptTokens: 100,
          CompletionTokens: 50,
          CreatedAt: "2026-08-01 10:00:01.000",
          LastEventOccurredAt: "2026-08-01 10:05:00.000",
        },
      ]);

      await replayGooseMigrationUp({
        client: ch,
        fileName: VERSION_COLUMN_MIGRATION,
        afterStatement: async ({ statement }) => {
          if (!/INSERT INTO\s+\S*governance_kpis_v2/i.test(statement)) return;
          injectedDuringCopy = true;
          // Same trace, a later cumulative total, higher CreatedAt.
          await insertKpiRows([
            {
              TraceId: "trace-accumulating",
              SpendUsd: 1.5,
              PromptTokens: 300,
              CompletionTokens: 150,
              CreatedAt: "2026-08-01 10:00:02.000",
              LastEventOccurredAt: "2026-08-01 09:55:00.000",
            },
          ]);
        },
      });
    }, 120_000);

    it("collapses to the latest cumulative total after merge", async () => {
      expect(injectedDuringCopy).toBe(true);
      await ch.command({ query: "OPTIMIZE TABLE governance_kpis FINAL" });

      const rows = await readKpiRows();
      const accumulating = rows.filter(
        (row) => row.TraceId === "trace-accumulating",
      );

      expect(accumulating).toHaveLength(1);
      expect(accumulating[0]!.SpendUsd).toBe(1.5);
      expect(accumulating[0]!.PromptTokens).toBe(300);
    });
  });
});
