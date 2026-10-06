import { type UpgradeLease, upgradeLeaseSchema, type UpgradeStepStatus } from "../ledger.ts";
import type { ManifestStep } from "../manifest/manifest.ts";
import type { UpgradePostgres } from "../ports.ts";

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

  async ledgerExists(): Promise<boolean> {
    const { rows } = await this.postgres.query<{ present: boolean }>(
      `SELECT to_regclass('_langwatch_upgrade_step') IS NOT NULL
          AND to_regclass('_langwatch_upgrade_run') IS NOT NULL AS present`,
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
    const { rows } = await this.postgres.query<{ empty: boolean }>(
      `SELECT NOT EXISTS (SELECT 1 FROM "_langwatch_upgrade_step")
          AND NOT EXISTS (SELECT 1 FROM "_langwatch_upgrade_run") AS empty`,
    );
    return rows[0]?.empty === true;
  }

  async findLease({ name }: { name: string }): Promise<UpgradeLease | null> {
    const { rows } = await this.postgres.query<object>(
      `SELECT "name", "owner", "image", "host",
              "heartbeat_at" AT TIME ZONE 'UTC' AS "heartbeatAt",
              "expires_at" AT TIME ZONE 'UTC' AS "expiresAt"
         FROM "_langwatch_upgrade_lease" WHERE "name" = $1`,
      [name],
    );
    return rows[0] ? upgradeLeaseSchema.parse(rows[0]) : null;
  }

  /**
   * Registers steps as `pending`. A step already recorded keeps its status; it gains the release
   * that shipped it, and its owner and description are refreshed from the manifest.
   */
  async registerSteps({ steps }: { steps: readonly RegisteredStep[] }): Promise<void> {
    if (steps.length === 0) return;
    await this.postgres.query(
      `INSERT INTO "_langwatch_upgrade_step" AS step
              ("id", "kind", "mode", "release", "owner", "description", "status", "inferred", "updated_at")
       SELECT source.id, source.kind, source.mode, source.release, source.owner, source.description,
              'pending', false, ${NOW_UTC}
         FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[])
              AS source(id, kind, mode, release, owner, description)
       ON CONFLICT ("id") DO UPDATE
          SET "release" = COALESCE(EXCLUDED."release", step."release"),
              "owner" = COALESCE(EXCLUDED."owner", step."owner"),
              "description" = EXCLUDED."description"
        WHERE step."release" IS DISTINCT FROM COALESCE(EXCLUDED."release", step."release")
           OR step."owner" IS DISTINCT FROM COALESCE(EXCLUDED."owner", step."owner")
           OR step."description" IS DISTINCT FROM EXCLUDED."description"`,
      [
        steps.map((step) => step.id),
        steps.map((step) => step.kind),
        steps.map((step) => step.mode),
        steps.map((step) => step.release),
        steps.map((step) => step.owner),
        steps.map((step) => step.description),
      ],
    );
  }

  /** Marks a step `running` for this run and counts the attempt. */
  async markRunning({ id, runId }: { id: string; runId: string }): Promise<void> {
    await this.postgres.query(
      `UPDATE "_langwatch_upgrade_step"
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
    await this.postgres.query(
      `UPDATE "_langwatch_upgrade_step"
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

  /** Saves a running step's checkpoint report, so a resumed attempt starts from it. */
  async saveReport({ id, report }: { id: string; report: Record<string, unknown> }): Promise<void> {
    await this.postgres.query(
      `UPDATE "_langwatch_upgrade_step" SET "report" = $2::jsonb, "updated_at" = ${NOW_UTC}
        WHERE "id" = $1`,
      [id, JSON.stringify(report)],
    );
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
    await this.postgres.query(
      `UPDATE "_langwatch_upgrade_run" SET "release" = $2, "plan" = $3::jsonb WHERE "id" = $1`,
      [runId, release, JSON.stringify(plan)],
    );
  }
}
