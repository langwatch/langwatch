import type { UpgradeClickHouse } from "../ports.ts";
import { gooseSteps, readGooseVersions } from "../seed-sources.ts";

/** What applying the schema did on one target: Postgres, or one ClickHouse endpoint. */
export type SchemaTargetReport =
  | { engine: "postgres"; target: string; ok: boolean; error: string | null }
  | {
      engine: "clickhouse";
      target: string;
      ok: boolean;
      error: string | null;
      /** The `clickhouse:<version>` ids goose records applied there; null when unreadable. */
      applied: ReadonlySet<string> | null;
    };

/** How the ledger names a private ClickHouse target: `private:<organizationId>`. */
export const PRIVATE_TARGET_PREFIX = "private:";

/** A private target holds only its organizations; any other target holds the installation. */
export function isPrivateTarget({ target }: { target: string }): boolean {
  return target.startsWith(PRIVATE_TARGET_PREFIX);
}

/**
 * Applies the image's schema. `release` is the release to stop at (null: every step the image
 * ships); an applier that cannot step applies everything on its first call (rethink 6.4, 6.5).
 * Postgres sessions carry `lock_timeout`; it runs under the lease, the first Prisma deploy too.
 */
export interface UpgradeSchemaApplier {
  apply(args: {
    release: string | null;
    lockTimeoutMs: number;
    signal: AbortSignal;
    /** ClickHouse targets this run already holds back; the applier leaves them alone. */
    skipTargets?: ReadonlySet<string>;
  }): Promise<readonly SchemaTargetReport[]>;
  /**
   * `prisma migrate resolve --rolled-back` for one failed migration the image ships. Absent: the
   * runner never resolves and names the command instead
   * (specs/upgrade/rerunnable-migrations.feature).
   */
  resolveRolledBack?(args: {
    migration: string;
    signal: AbortSignal;
  }): Promise<{ ok: boolean; error: string | null }>;
}

/** A level-triggered reconciler run as the last phase of every upgrade (TTL, LangWatchQL). */
export interface UpgradeReconciler {
  readonly name: string;
  /** The ClickHouse target it reconciles, when one; skipped while the run holds that target. */
  readonly target?: string;
  run(args: { signal: AbortSignal }): Promise<void>;
}

/** Where the runner reports progress; the caller adapts its own logger. */
export interface UpgradeRunnerLog {
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
}

/** The step ids goose records applied on one ClickHouse database, for a ClickHouse applier. */
export async function gooseAppliedStepIds({
  clickhouse,
}: {
  clickhouse: UpgradeClickHouse;
}): Promise<Set<string>> {
  const steps = gooseSteps({ rows: await readGooseVersions({ clickhouse }) });
  return new Set(steps.filter((step) => step.status === "done").map((step) => step.id));
}
