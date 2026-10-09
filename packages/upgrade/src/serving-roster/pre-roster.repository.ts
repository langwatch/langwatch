import { generate } from "@langwatch/ksuid";
import { z } from "zod";

import { createLedgerTables, ledgerTables } from "../ledger-tables.ts";
import type { UpgradePostgres } from "../ports.ts";
import type { PreRosterHistory } from "./pre-roster.ts";

/** Runner-owned overrides for writers before the roster, beside the roster in the ledger schema. */
export const SERVING_ROSTER_OVERRIDE_TABLE = "_langwatch_serving_roster_override";

export const servingRosterOverrideKindSchema = z.enum(["old-writers-gone", "pre-roster-rollback"]);
export type ServingRosterOverrideKind = z.infer<typeof servingRosterOverrideKindSchema>;

const NOW_UTC = `(now() AT TIME ZONE 'UTC')`;
const quote = (identifier: string) => `"${identifier.replaceAll('"', '""')}"`;

const overrideRowSchema = z.object({ kind: z.string(), at: z.date() });
const atRowSchema = z.object({ at: z.date() });
const probeRowSchema = z.object({ runs: z.boolean(), overrides: z.boolean(), now: z.date() });

/**
 * Reads and records writers before the roster (Round 47 E2). The table is created by the first
 * record, re-runnably; until then the history holds only the seed and the upgrade runs.
 */
export class PreRosterRepository {
  private constructor(private readonly postgres: UpgradePostgres) {}

  static create({ postgres }: { postgres: UpgradePostgres }): PreRosterRepository {
    return new PreRosterRepository(postgres);
  }

  private async names() {
    const tables = await ledgerTables({ postgres: this.postgres });
    return {
      ...tables,
      override: `${quote(tables.schema)}.${quote(SERVING_ROSTER_OVERRIDE_TABLE)}`,
    };
  }

  async findPreRosterHistory(): Promise<PreRosterHistory> {
    const t = await this.names();
    const { rows } = await this.postgres.query<object>(
      `SELECT to_regclass($1) IS NOT NULL AS "runs", to_regclass($2) IS NOT NULL AS "overrides",
              now() AS "now"`,
      [t.run, t.override],
    );
    const probe = probeRowSchema.parse(rows[0]);
    const history: PreRosterHistory = {
      now: probe.now,
      seededFromExistingAt: null,
      rollbacksAt: [],
      assertionsAt: [],
      upgradesFinishedAt: [],
    };
    if (!probe.runs) return history;
    const seeded = await this.postgres.query<object>(
      `SELECT "started_at" AT TIME ZONE 'UTC' AS "at" FROM ${t.run}
        WHERE "kind" = 'seed' AND "outcome" = 'succeeded'
          AND jsonb_typeof("report" -> 'seeded') = 'object' AND "report" -> 'seeded' <> '{}'::jsonb
        ORDER BY "started_at" LIMIT 1`,
    );
    const upgrades = await this.postgres.query<object>(
      `SELECT "finished_at" AT TIME ZONE 'UTC' AS "at" FROM ${t.run}
        WHERE "kind" = 'upgrade' AND "outcome" = 'succeeded' AND "finished_at" IS NOT NULL`,
    );
    history.seededFromExistingAt = seeded.rows.map((row) => atRowSchema.parse(row).at)[0] ?? null;
    history.upgradesFinishedAt = upgrades.rows.map((row) => atRowSchema.parse(row).at);
    if (!probe.overrides) return history;
    const overrides = await this.postgres.query<object>(
      `SELECT "kind", "recorded_at" AT TIME ZONE 'UTC' AS "at" FROM ${t.override}`,
    );
    const parsed = overrides.rows.map((row) => overrideRowSchema.parse(row));
    history.rollbacksAt = parsed
      .filter((row) => row.kind === "pre-roster-rollback")
      .map((r) => r.at);
    history.assertionsAt = parsed.filter((row) => row.kind === "old-writers-gone").map((r) => r.at);
    return history;
  }

  /** Records one override by the database clock; answers when. */
  async record({ kind, actor }: { kind: ServingRosterOverrideKind; actor: string }) {
    await createLedgerTables({ postgres: this.postgres });
    const t = await this.names();
    await this.postgres.query(
      `CREATE TABLE IF NOT EXISTS ${t.override} (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "recorded_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "_langwatch_serving_roster_override_pkey" PRIMARY KEY ("id")
)`,
    );
    const { rows } = await this.postgres.query<object>(
      `INSERT INTO ${t.override} ("id", "kind", "actor", "recorded_at")
       VALUES ($1, $2, $3, ${NOW_UTC})
       RETURNING "recorded_at" AT TIME ZONE 'UTC' AS "at"`,
      [generate("rosteroverride").toString(), kind, actor],
    );
    return atRowSchema.parse(rows[0]).at;
  }
}
