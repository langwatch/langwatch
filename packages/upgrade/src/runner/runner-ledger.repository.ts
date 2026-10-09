import { type LedgerTableNames, ledgerTables } from "../ledger-tables.ts";
import { type UpgradeLease, upgradeLeaseSchema, type UpgradeStepStatus } from "../ledger.ts";
import type { ManifestStep } from "../manifest/manifest.ts";
import type { UpgradePostgres } from "../ports.ts";
import { PROJECTION_REPLAY_CURSOR } from "../step/projection-replay-step.ts";

const NOW_UTC = `(now() AT TIME ZONE 'UTC')`;
const SETTLED: ReadonlySet<UpgradeStepStatus> = new Set(["done", "not-needed", "failed"]);

/** A step the runner registers: a manifest step with the release that shipped it. */
export type RegisteredStep = ManifestStep & { release: string | null };

/**
 * The runner's writes to the ledger beyond `UpgradeLedgerRepository`'s: step status transitions,
 * release attribution and the run's plan. Same tables, same package, as the reader's repository.
 */
export class UpgradeRunnerRepository {
  private constructor(private readonly postgres: UpgradePostgres) {}

  static create({ postgres }: { postgres: UpgradePostgres }): UpgradeRunnerRepository {
    return new UpgradeRunnerRepository(postgres);
  }

  /** Runs `text` against this installation's ledger tables (`ledgerTables`). */
  private async query<Row extends object>(
    text: (tables: LedgerTableNames) => string,
    values?: unknown[],
  ): Promise<{ rows: Row[] }> {
    return this.postgres.query<Row>(text(await ledgerTables({ postgres: this.postgres })), values);
  }

  async ledgerExists(): Promise<boolean> {
    const { rows } = await this.query<{ present: boolean }>(
      (t) => `SELECT to_regclass('${t.step}') IS NOT NULL
          AND to_regclass('${t.run}') IS NOT NULL AS present`,
    );
    return rows[0]?.present === true;
  }

  async prismaHistoryExists(): Promise<boolean> {
    const { rows } = await this.postgres.query<{ present: boolean }>(
      `SELECT to_regclass('_prisma_migrations') IS NOT NULL AS present`,
    );
    return rows[0]?.present === true;
  }

  async isEmpty(): Promise<boolean> {
    const { rows } = await this.query<{ empty: boolean }>(
      (t) => `SELECT NOT EXISTS (SELECT 1 FROM ${t.step})
          AND NOT EXISTS (SELECT 1 FROM ${t.run}) AS empty`,
    );
    return rows[0]?.empty === true;
  }

  async findLease({ name }: { name: string }): Promise<UpgradeLease | null> {
    const { rows } = await this.query<object>(
      (t) => `SELECT "name", "owner", "image", "host",
              "heartbeat_at" AT TIME ZONE 'UTC' AS "heartbeatAt",
              "expires_at" AT TIME ZONE 'UTC' AS "expiresAt"
         FROM ${t.lease} WHERE "name" = $1`,
      [name],
    );
    return rows[0] ? upgradeLeaseSchema.parse(rows[0]) : null;
  }

  /**
   * Registers steps as `pending`. A step already recorded keeps its status; it gains the release
   * that shipped it, and its owner, description and `finishBy` are refreshed from the manifest.
   */
  async registerSteps({ steps }: { steps: readonly RegisteredStep[] }): Promise<void> {
    if (steps.length === 0) return;
    await this.query(
      (t) => `INSERT INTO ${t.step} AS step
              ("id", "kind", "mode", "release", "owner", "description", "finish_by", "status", "inferred",
               "updated_at")
       SELECT source.id, source.kind, source.mode, source.release, source.owner, source.description,
              source.finish_by, 'pending', false, ${NOW_UTC}
         FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[])
              AS source(id, kind, mode, release, owner, description, finish_by)
       ON CONFLICT ("id") DO UPDATE
          SET "release" = COALESCE(EXCLUDED."release", step."release"),
              "owner" = COALESCE(EXCLUDED."owner", step."owner"),
              "description" = EXCLUDED."description",
              "finish_by" = EXCLUDED."finish_by"
        WHERE step."release" IS DISTINCT FROM COALESCE(EXCLUDED."release", step."release")
           OR step."owner" IS DISTINCT FROM COALESCE(EXCLUDED."owner", step."owner")
           OR step."description" IS DISTINCT FROM EXCLUDED."description"
           OR step."finish_by" IS DISTINCT FROM EXCLUDED."finish_by"`,
      [
        steps.map((step) => step.id),
        steps.map((step) => step.kind),
        steps.map((step) => step.mode),
        steps.map((step) => step.release),
        steps.map((step) => step.owner),
        steps.map((step) => step.description),
        steps.map((step) => step.finishBy ?? null),
      ],
    );
  }

  /** Marks a step `running` for this run and counts the attempt. */
  async markRunning({ id, runId }: { id: string; runId: string }): Promise<void> {
    await this.query(
      (t) => `UPDATE ${t.step}
          SET "status" = 'running', "run_id" = $2, "attempt" = "attempt" + 1,
              "started_at" = ${NOW_UTC}, "finished_at" = NULL, "updated_at" = ${NOW_UTC}
        WHERE "id" = $1`,
      [id, runId],
    );
  }

  /** Sets the status of steps the runner settled or reopened; a settled one stamps its finish. */
  async setStatus({
    ids,
    status,
    runId,
    lastError = null,
    report,
  }: {
    ids: readonly string[];
    status: UpgradeStepStatus;
    runId: string;
    lastError?: string | null;
    report?: Record<string, unknown>;
  }): Promise<void> {
    if (ids.length === 0) return;
    await this.query(
      (t) => `UPDATE ${t.step}
          SET "status" = $2, "run_id" = $3, "last_error" = $4, "inferred" = false,
              "report" = COALESCE($5::jsonb, "report"),
              "finished_at" = CASE WHEN $6::boolean THEN ${NOW_UTC} ELSE NULL END,
              "updated_at" = ${NOW_UTC}
        WHERE "id" = ANY($1::text[])`,
      [
        ids,
        status,
        runId,
        lastError,
        report === undefined ? null : JSON.stringify(report),
        SETTLED.has(status),
      ],
    );
  }

  /**
   * Level-triggers a tenant step's row: `done` once no tenant is held or parked, `pending` when one
   * is again. Rows in any other status are the runner's or the operator's and stay as they are.
   */
  async settleTenantStep({ id, settled }: { id: string; settled: boolean }): Promise<void> {
    const status: UpgradeStepStatus = settled ? "done" : "pending";
    await this.query(
      (t) => `UPDATE ${t.step}
          SET "status" = $2, "inferred" = false,
              "finished_at" = CASE WHEN $3::boolean THEN ${NOW_UTC} ELSE NULL END,
              "updated_at" = ${NOW_UTC}
        WHERE "id" = $1 AND "kind" = 'tenant' AND "status" IN ('pending', 'done')
          AND "status" <> $2`,
      [id, status, settled],
    );
  }

  /** Saves a running step's checkpoint report, so a resumed attempt starts from it. */
  async saveReport({ id, report }: { id: string; report: Record<string, unknown> }): Promise<void> {
    await this.query(
      (t) => `UPDATE ${t.step} SET "report" = $2::jsonb, "updated_at" = ${NOW_UTC}
        WHERE "id" = $1`,
      [id, JSON.stringify(report)],
    );
  }

  /** The database clock as ISO 8601 UTC, so a phase is stamped by the clock every row is. */
  async databaseNow(): Promise<string> {
    const { rows } = await this.postgres.query<{ now: string }>(
      `SELECT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "now"`,
    );
    const now = rows[0]?.now;
    if (!now) throw new Error("the database answered no time");
    return now;
  }

  /** Writes a moving run's report (its phases so far); `finishRun` writes the final one. */
  async recordRunReport({
    runId,
    report,
  }: {
    runId: string;
    report: Record<string, unknown>;
  }): Promise<void> {
    await this.query(
      (t) => `UPDATE ${t.run} SET "report" = $2::jsonb
        WHERE "id" = $1 AND "finished_at" IS NULL`,
      [runId, JSON.stringify(report)],
    );
  }

  /**
   * Reopens done steps as pending, checkpoint cleared so the re-run is whole, except a projection
   * replay's cursor, which a re-run continues from. Answers the ids this call reopened: one
   * already reopened, here or concurrently, is not reopened twice.
   */
  async reopenDoneSteps({
    ids,
    reason,
  }: {
    ids: readonly string[];
    reason: string;
  }): Promise<string[]> {
    if (ids.length === 0) return [];
    const { rows } = await this.query<{ id: string }>(
      (t) => `UPDATE ${t.step}
          SET "status" = 'pending', "last_error" = $2, "inferred" = false, "finished_at" = NULL,
              "report" = CASE WHEN "report" ? $3 THEN "report" END,
              "updated_at" = ${NOW_UTC}
        WHERE "id" = ANY($1::text[]) AND "status" = 'done'
       RETURNING "id"`,
      [ids, reason, PROJECTION_REPLAY_CURSOR],
    );
    return rows.map((row) => row.id).toSorted();
  }

  /**
   * Sets one failed step pending in a single conditional write, error cleared and checkpoint kept.
   * Answers false when the step is not failed, so of two concurrent retries only one wins.
   */
  async retryFailedStep({ id }: { id: string }): Promise<boolean> {
    const { rows } = await this.query<{ id: string }>(
      (t) => `UPDATE ${t.step}
          SET "status" = 'pending', "last_error" = NULL, "inferred" = false, "finished_at" = NULL,
              "updated_at" = ${NOW_UTC}
        WHERE "id" = $1 AND "status" = 'failed'
       RETURNING "id"`,
      [id],
    );
    return rows.length > 0;
  }

  /** Sets failed steps of one mode pending again, error and checkpoint kept; answers their ids. */
  async resetFailedSteps({
    mode,
    runId,
  }: {
    mode: ManifestStep["mode"];
    runId: string;
  }): Promise<string[]> {
    const { rows } = await this.query<{ id: string }>(
      (t) => `UPDATE ${t.step}
          SET "status" = 'pending', "run_id" = $2, "finished_at" = NULL, "updated_at" = ${NOW_UTC}
        WHERE "mode" = $1 AND "status" = 'failed'
       RETURNING "id"`,
      [mode, runId],
    );
    return rows.map((row) => row.id).toSorted();
  }

  /** Deletes roster entries not written for `deadForMs` by the database clock; answers how many. */
  async pruneServingRoster({ deadForMs }: { deadForMs: number }): Promise<number> {
    const { rows } = await this.query<{ processId: string }>(
      (t) => `DELETE FROM ${t.roster}
        WHERE "heartbeat_at" < ${NOW_UTC} - ($1::double precision * interval '1 millisecond')
       RETURNING "process_id" AS "processId"`,
      [deadForMs],
    );
    return rows.length;
  }

  /** Records the release the run upgrades to and the plan it printed. */
  async recordRunPlan({
    runId,
    release,
    plan,
  }: {
    runId: string;
    release: string | null;
    plan: Record<string, unknown>;
  }): Promise<void> {
    await this.query(
      (t) => `UPDATE ${t.run} SET "release" = $2, "plan" = $3::jsonb WHERE "id" = $1`,
      [runId, release, JSON.stringify(plan)],
    );
  }
}
