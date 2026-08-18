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
 * These tests run the real migration file against the real table, staged into
 * its pre-upgrade state, because the two things that can actually break are
 * properties of the swap procedure and not of ClickHouse:
 *   - the copy reads a snapshot, so a write arriving mid-migration must still
 *     survive (the reconciliation pass),
 *   - the runner may re-apply a partially executed file, so a second run must
 *     converge rather than wedge.
 *
 * @see https://github.com/langwatch/langwatch-saas/issues/1089
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { generate } from "@langwatch/ksuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  startTestContainers,
  stopTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";
import { replayGooseMigrationUp } from "./migrationReplay";

const CREATE_MIGRATION = "00031_create_governance_kpis.sql";
const VERSION_COLUMN_MIGRATION =
  "00083_governance_kpis_version_column_fix.sql";

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
 * Puts `governance_kpis` back in the shape 00031 left it: the pre-upgrade
 * engine, empty. The suite has to start from there because 00083 is what is
 * under test, and the migrated container already has it applied.
 */
async function stageThePreUpgradeTable(): Promise<void> {
  await ch.command({ query: "DROP TABLE IF EXISTS governance_kpis" });
  await replayGooseMigrationUp({ client: ch, fileName: CREATE_MIGRATION });
}

beforeAll(async () => {
  const containers = await startTestContainers();
  ch = containers.clickHouseClient;
}, 120_000);

afterAll(async () => {
  if (ch) {
    // Later suites must see the head schema, not whichever intermediate state
    // the last test left behind.
    await stageThePreUpgradeTable();
    await replayGooseMigrationUp({
      client: ch,
      fileName: VERSION_COLUMN_MIGRATION,
    });
  }
  await stopTestContainers();
}, 120_000);

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

    /** @scenario A trace written during the copy is not discarded by the swap */
    it("keeps both the copied row and the one that raced the copy", async () => {
      expect(injectedDuringCopy).toBe(true);

      const rows = await readKpiRows();

      expect(rows.map((row) => row.TraceId)).toEqual([
        "trace-copied",
        "trace-raced-the-copy",
      ]);
      expect(rows.map((row) => row.SpendUsd)).toEqual([0.25, 0.75]);
    });

    /** @scenario The rebuilt table versions rows by a clock that only moves forward */
    it("versions the rebuilt table by CreatedAt", async () => {
      expect(await versionColumnOf("governance_kpis")).toContain(
        "ReplacingMergeTree(CreatedAt)",
      );
    });

    /** @scenario The scratch table does not outlive the migration */
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

    /** @scenario Re-applying a partially executed migration converges instead of wedging */
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

    /** @scenario A merge keeps the latest fold, not the one with the latest event */
    it("keeps the cumulative totals after merge", async () => {
      const rows = await readKpiRows();
      const refolded = rows.filter((row) => row.TraceId === "trace-refolded");

      expect(refolded).toHaveLength(1);
      expect(refolded[0]!.SpendUsd).toBe(1.5);
      expect(refolded[0]!.PromptTokens).toBe(300);
    });
  });
  describe("given a previous run died after the swap", () => {
    /**
     * The state a `RENAME`-based swap cannot recover from: the pre-swap table
     * still exists under the scratch name, so a re-apply that renamed onto an
     * existing name would fail and need a human in the database.
     */
    let crashed = false;

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
          if (!/EXCHANGE TABLES/i.test(statement)) return;
          crashed = true;
          throw new Error("simulated runner crash after the swap");
        },
      }).catch(() => undefined);

      await replayGooseMigrationUp({
        client: ch,
        fileName: VERSION_COLUMN_MIGRATION,
      });
    }, 120_000);

    /** @scenario Re-applying after a crash mid-swap converges instead of wedging */
    it("re-applies cleanly and keeps the rows", async () => {
      expect(crashed).toBe(true);

      const rows = await readKpiRows();

      expect(rows.map((row) => row.TraceId)).toEqual([
        "trace-before-the-crash",
      ]);
      expect(rows[0]!.SpendUsd).toBe(2);
      expect(await versionColumnOf("governance_kpis")).toContain(
        "ReplacingMergeTree(CreatedAt)",
      );
    });
  });

});
