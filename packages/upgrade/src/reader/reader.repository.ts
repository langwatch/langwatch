import { z } from "zod";

import { type LedgerTableNames, ledgerTables } from "../ledger-tables.ts";
import type { UpgradePostgres } from "../ports.ts";

const nullable = <Schema extends z.ZodType>(schema: Schema) =>
  schema.nullish().transform((value) => value ?? null);

/** `timestamp(3)` columns hold UTC; to_jsonb renders them without an offset, so one is added. */
const instant = z
  .string()
  .nullish()
  .transform((value) => {
    if (!value) return null;
    return /(Z|[+-]\d\d(:?\d\d)?)$/.test(value) ? value : `${value}Z`;
  });

const jsonObject = nullable(z.record(z.string(), z.unknown()));

/**
 * Rows are read as `to_jsonb(row)`, so a column a newer runner added is simply absent here and a
 * column an older ledger lacks is simply null: the reader needs no knowledge of the table's age.
 */
const stepRowSchema = z.object({
  id: z.string(),
  kind: z.string(),
  release: nullable(z.string()),
  mode: z.string(),
  status: z.string(),
  inferred: z
    .boolean()
    .nullish()
    .transform((value) => value ?? false),
  attempt: z
    .number()
    .nullish()
    .transform((value) => value ?? 0),
  last_error: nullable(z.string()),
  report: jsonObject,
  run_id: nullable(z.string()),
  started_at: instant,
  finished_at: instant,
  updated_at: instant,
  owner: nullable(z.string()),
  description: nullable(z.string()),
});
export type LedgerStepRow = z.infer<typeof stepRowSchema>;

const stepFactSchema = z.object({
  id: z.string(),
  kind: z.string(),
  mode: z.string(),
  status: z.string(),
  release: nullable(z.string()),
  inferred: z.boolean(),
});
export type LedgerStepFact = z.infer<typeof stepFactSchema>;

const runRowSchema = z.object({
  id: z.string(),
  kind: z.string(),
  release: nullable(z.string()),
  floor: nullable(z.string()),
  started_at: instant.transform((value) => value ?? "1970-01-01T00:00:00Z"),
  finished_at: instant,
  outcome: nullable(z.string()),
  plan: jsonObject,
  report: jsonObject,
});
export type LedgerRunRow = z.infer<typeof runRowSchema>;

const targetRowSchema = z.object({
  target: z.string(),
  status: z.string(),
  version: nullable(z.string()),
  last_error: nullable(z.string()),
  updated_at: instant,
});
export type LedgerTargetRow = z.infer<typeof targetRowSchema>;

const leaseRowSchema = z.object({
  name: nullable(z.string()),
  owner: nullable(z.string()),
  image: nullable(z.string()),
  host: nullable(z.string()),
  heartbeat_at: instant,
  expires_at: instant,
  live: z.boolean(),
});
export type LedgerLeaseRow = z.infer<typeof leaseRowSchema>;

const rosterRowSchema = z.object({
  role: z.string(),
  image: z.string(),
  release: nullable(z.string()),
  steps: z.array(z.string()),
  heartbeat_at: instant,
});
export type LedgerRosterRow = z.infer<typeof rosterRowSchema>;

export interface LedgerTables {
  step: boolean;
  run: boolean;
  lease: boolean;
  target: boolean;
  roster: boolean;
}

const jsonRows = z.array(z.object({ row: z.unknown() }));

/** Reads of the ledger tables for the reader, and nothing else. Never per-tenant state. */
export class UpgradeReaderRepository {
  private constructor(private readonly postgres: UpgradePostgres) {}

  static create({ postgres }: { postgres: UpgradePostgres }): UpgradeReaderRepository {
    return new UpgradeReaderRepository(postgres);
  }

  /** Runs `text` against this installation's ledger tables (`ledgerTables`). */
  private async query<Row extends object>(
    text: (tables: LedgerTableNames) => string,
    values?: unknown[],
  ): Promise<{ rows: Row[] }> {
    return this.postgres.query<Row>(text(await ledgerTables({ postgres: this.postgres })), values);
  }

  private async queryRows({
    text,
    values,
  }: {
    text: (tables: LedgerTableNames) => string;
    values?: unknown[];
  }) {
    const { rows } = await this.query<object>(text, values);
    return jsonRows.parse(rows).map((entry) => entry.row);
  }

  /** Which ledger tables exist: an old installation, or one before the first upgrade, has few. */
  async findTables(): Promise<LedgerTables> {
    const { rows } = await this.query<Record<keyof LedgerTables, boolean>>(
      (t) => `SELECT to_regclass('${t.step}') IS NOT NULL AS "step",
              to_regclass('${t.run}') IS NOT NULL AS "run",
              to_regclass('${t.lease}') IS NOT NULL AS "lease",
              to_regclass('${t.target}') IS NOT NULL AS "target",
              to_regclass('${t.roster}') IS NOT NULL AS "roster"`,
    );
    const row = rows[0];
    return {
      step: row?.step ?? false,
      run: row?.run ?? false,
      lease: row?.lease ?? false,
      target: row?.target ?? false,
      roster: row?.roster ?? false,
    };
  }

  async findStepFacts({ tables }: { tables: LedgerTables }): Promise<LedgerStepFact[]> {
    if (!tables.step) return [];
    const { rows } = await this.query<object>(
      (t) => `SELECT "id", "kind", "mode", "status", "release", "inferred" FROM ${t.step}`,
    );
    return rows.map((row) => stepFactSchema.parse(row));
  }

  async findSteps({
    tables,
    runId,
  }: {
    tables: LedgerTables;
    runId?: string;
  }): Promise<LedgerStepRow[]> {
    if (!tables.step) return [];
    const rows = await this.queryRows({
      text: (t) => `SELECT to_jsonb(step) AS "row" FROM ${t.step} step
              WHERE ($1::text IS NULL OR step."run_id" = $1) ORDER BY step."id"`,
      values: [runId ?? null],
    });
    return rows.map((row) => stepRowSchema.parse(row));
  }

  async findStepById({
    tables,
    id,
  }: {
    tables: LedgerTables;
    id: string;
  }): Promise<LedgerStepRow[]> {
    if (!tables.step) return [];
    const rows = await this.queryRows({
      text: (t) => `SELECT to_jsonb(step) AS "row" FROM ${t.step} step WHERE step."id" = $1`,
      values: [id],
    });
    return rows.map((row) => stepRowSchema.parse(row));
  }

  async findTargets({
    tables,
    stepId,
  }: {
    tables: LedgerTables;
    stepId: string;
  }): Promise<LedgerTargetRow[]> {
    if (!tables.target) return [];
    const rows = await this.queryRows({
      text: (t) => `SELECT to_jsonb(entry) AS "row" FROM ${t.target} entry
              WHERE entry."step_id" = $1 ORDER BY entry."target"`,
      values: [stepId],
    });
    return rows.map((row) => targetRowSchema.parse(row));
  }

  async countFailedTargets({ tables }: { tables: LedgerTables }): Promise<number> {
    if (!tables.target) return 0;
    const { rows } = await this.query<{ failed: string }>(
      (t) => `SELECT count(*)::text AS "failed" FROM ${t.target} WHERE "status" = 'failed'`,
    );
    return Number(rows[0]?.failed ?? 0);
  }

  /** Every lease row, `live` judged by the database clock; one row per named lease, so tiny. */
  async findLeases({ tables }: { tables: LedgerTables }): Promise<LedgerLeaseRow[]> {
    if (!tables.lease) return [];
    const rows = await this.queryRows({
      text: (t) => `SELECT to_jsonb(lease)
                     || jsonb_build_object('live', lease."expires_at" > (now() AT TIME ZONE 'UTC'))
                     AS "row" FROM ${t.lease} lease`,
    });
    return rows.map((row) => leaseRowSchema.parse(row));
  }

  /** Serving processes that heartbeated within `staleAfterMs` of the database clock. */
  async findLiveRoster({
    tables,
    staleAfterMs,
  }: {
    tables: LedgerTables;
    staleAfterMs: number;
  }): Promise<LedgerRosterRow[]> {
    if (!tables.roster) return [];
    const rows = await this.queryRows({
      text: (t) => `SELECT to_jsonb(entry) AS "row" FROM ${t.roster} entry
              WHERE entry."heartbeat_at" >= (now() AT TIME ZONE 'UTC')
                    - ($1::double precision * interval '1 millisecond')
              ORDER BY entry."process_id"`,
      values: [staleAfterMs],
    });
    return rows.map((row) => rosterRowSchema.parse(row));
  }

  async findLatestRun({ tables }: { tables: LedgerTables }): Promise<LedgerRunRow | null> {
    if (!tables.run) return null;
    const rows = await this.queryRows({
      text: (t) => `SELECT to_jsonb(run) - 'plan' - 'report' AS "row" FROM ${t.run} run
              ORDER BY run."started_at" DESC, run."id" DESC LIMIT 1`,
    });
    const row = rows[0];
    return row === undefined ? null : runRowSchema.parse(row);
  }

  /** The newest run that succeeded and recorded a release: where the installation stands. */
  async findLatestSucceededRun({ tables }: { tables: LedgerTables }): Promise<LedgerRunRow | null> {
    if (!tables.run) return null;
    const rows = await this.queryRows({
      text: (t) => `SELECT to_jsonb(run) - 'plan' - 'report' AS "row" FROM ${t.run} run
              WHERE run."outcome" = 'succeeded' AND run."release" IS NOT NULL
              ORDER BY run."started_at" DESC, run."id" DESC LIMIT 1`,
    });
    const row = rows[0];
    return row === undefined ? null : runRowSchema.parse(row);
  }

  /** An `upgrade` run that has not finished: the lease's stand-in before the lease table exists. */
  async hasUnfinishedUpgradeRun({ tables }: { tables: LedgerTables }): Promise<boolean> {
    if (!tables.run) return false;
    const { rows } = await this.query<{ found: boolean }>(
      (t) => `SELECT EXISTS (SELECT 1 FROM ${t.run}
                       WHERE "kind" = 'upgrade' AND "finished_at" IS NULL) AS "found"`,
    );
    return rows[0]?.found ?? false;
  }

  async hasAnyRun({ tables }: { tables: LedgerTables }): Promise<boolean> {
    if (!tables.run) return false;
    const { rows } = await this.query<{ found: boolean }>(
      (t) => `SELECT EXISTS (SELECT 1 FROM ${t.run}) AS "found"`,
    );
    return rows[0]?.found ?? false;
  }

  /** The floors runs applied with; read through to_jsonb, so an older ledger has none. */
  async findRecordedFloors({ tables }: { tables: LedgerTables }): Promise<string[]> {
    if (!tables.run) return [];
    const { rows } = await this.query<{ floor: string }>(
      (t) => `SELECT DISTINCT to_jsonb(run) ->> 'floor' AS "floor" FROM ${t.run} run
        WHERE to_jsonb(run) ->> 'floor' IS NOT NULL`,
    );
    return rows.map((row) => row.floor);
  }

  async findRuns({
    tables,
    after,
    limit,
  }: {
    tables: LedgerTables;
    after: { startedAt: string; id: string } | null;
    limit: number;
  }): Promise<LedgerRunRow[]> {
    if (!tables.run) return [];
    const rows = await this.queryRows({
      text: (t) => `SELECT to_jsonb(run) - 'plan' - 'report' AS "row" FROM ${t.run} run
              WHERE ($1::text IS NULL
                     OR (run."started_at", run."id") < (($1::timestamptz AT TIME ZONE 'UTC'), $2::text))
              ORDER BY run."started_at" DESC, run."id" DESC LIMIT $3`,
      values: [after?.startedAt ?? null, after?.id ?? null, limit],
    });
    return rows.map((row) => runRowSchema.parse(row));
  }

  async findRunById({ tables, id }: { tables: LedgerTables; id: string }): Promise<LedgerRunRow[]> {
    if (!tables.run) return [];
    const rows = await this.queryRows({
      text: (t) => `SELECT to_jsonb(run) AS "row" FROM ${t.run} run WHERE run."id" = $1`,
      values: [id],
    });
    return rows.map((row) => runRowSchema.parse(row));
  }
}
