import { generate } from "@langwatch/ksuid";

import { createLedgerTables } from "./ledger-tables.ts";
import {
  type InferredStep,
  type UpgradeRun,
  type UpgradeRunKind,
  type UpgradeRunOutcome,
  upgradeRunSchema,
  type UpgradeStep,
  type UpgradeStepKind,
  upgradeStepKindSchema,
  upgradeStepSchema,
} from "./ledger.ts";
import type { UpgradePostgres } from "./ports.ts";

// The columns are TIMESTAMP(3) holding UTC, as Prisma writes them; read back as instants.
const NOW_UTC = `(now() AT TIME ZONE 'UTC')`;
const utc = (column: string, alias: string) => `"${column}" AT TIME ZONE 'UTC' AS "${alias}"`;

const RUN_COLUMNS = [
  `"id"`,
  `"kind"`,
  `"release"`,
  utc("started_at", "startedAt"),
  utc("finished_at", "finishedAt"),
  `"outcome"`,
  `"plan"`,
  `"report"`,
].join(", ");

const STEP_COLUMNS = [
  `"id"`,
  `"kind"`,
  `"release"`,
  `"mode"`,
  `"status"`,
  `"inferred"`,
  `"attempt"`,
  `"last_error" AS "lastError"`,
  `"report"`,
  `"run_id" AS "runId"`,
  utc("started_at", "startedAt"),
  utc("finished_at", "finishedAt"),
  utc("updated_at", "updatedAt"),
].join(", ");

/** The runner's own ledger tables. Only the runner package reads or writes them. */
export class UpgradeLedgerRepository {
  private constructor(private readonly postgres: UpgradePostgres) {}

  static create({ postgres }: { postgres: UpgradePostgres }): UpgradeLedgerRepository {
    return new UpgradeLedgerRepository(postgres);
  }

  async createTables(): Promise<void> {
    await createLedgerTables({ postgres: this.postgres });
  }

  async startRun({ kind }: { kind: UpgradeRunKind }): Promise<UpgradeRun> {
    const { rows } = await this.postgres.query<object>(
      `INSERT INTO "_langwatch_upgrade_run" ("id", "kind", "started_at")
       VALUES ($1, $2, ${NOW_UTC})
       RETURNING ${RUN_COLUMNS}`,
      [generate("upgraderun").toString(), kind],
    );
    return upgradeRunSchema.parse(rows[0]);
  }

  async finishRun({
    runId,
    outcome,
    report,
  }: {
    runId: string;
    outcome: UpgradeRunOutcome;
    report: Record<string, unknown>;
  }): Promise<UpgradeRun> {
    const { rows } = await this.postgres.query<object>(
      `UPDATE "_langwatch_upgrade_run"
          SET "finished_at" = ${NOW_UTC}, "outcome" = $2, "report" = $3::jsonb
        WHERE "id" = $1
       RETURNING ${RUN_COLUMNS}`,
      [runId, outcome, JSON.stringify(report)],
    );
    return upgradeRunSchema.parse(rows[0]);
  }

  /**
   * Writes steps read from another tool's record, marked inferred. A row the runner recorded
   * itself (not inferred) is never overwritten. Answers the kind of every row written.
   */
  async writeInferredSteps({
    runId,
    steps,
  }: {
    runId: string;
    steps: readonly InferredStep[];
  }): Promise<UpgradeStepKind[]> {
    if (steps.length === 0) return [];
    const { rows } = await this.postgres.query<{ kind: string }>(
      `INSERT INTO "_langwatch_upgrade_step" AS step
              ("id", "kind", "mode", "status", "last_error", "inferred", "run_id", "updated_at")
       SELECT source.id, source.kind, source.mode, source.status, source.last_error, true, $6, ${NOW_UTC}
         FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[])
              AS source(id, kind, mode, status, last_error)
       ON CONFLICT ("id") DO UPDATE
          SET "status" = EXCLUDED."status",
              "last_error" = EXCLUDED."last_error",
              "run_id" = EXCLUDED."run_id",
              "updated_at" = EXCLUDED."updated_at"
        WHERE step."inferred"
       RETURNING step."kind"`,
      [
        steps.map((step) => step.id),
        steps.map((step) => step.kind),
        steps.map((step) => step.mode),
        steps.map((step) => step.status),
        steps.map((step) => step.lastError),
        runId,
      ],
    );
    return rows.map((row) => upgradeStepKindSchema.parse(row.kind));
  }

  async findSteps(): Promise<UpgradeStep[]> {
    const { rows } = await this.postgres.query<object>(
      `SELECT ${STEP_COLUMNS} FROM "_langwatch_upgrade_step" ORDER BY "id"`,
    );
    return rows.map((row) => upgradeStepSchema.parse(row));
  }

  async findRuns(): Promise<UpgradeRun[]> {
    const { rows } = await this.postgres.query<object>(
      `SELECT ${RUN_COLUMNS} FROM "_langwatch_upgrade_run" ORDER BY "started_at", "id"`,
    );
    return rows.map((row) => upgradeRunSchema.parse(row));
  }
}
