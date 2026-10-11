/**
 * The re-runnable floor, the last folder of 3.20.1 (Alex, 2026-10-11): every folder after it is
 * re-runnable, which the `rerunnable-migrations` policy keeps. It may move earlier, never later:
 * specs/upgrade/rerunnable-migrations.feature.
 */
export const RERUNNABLE_PRISMA_FROM = "20261001120000_sso_provider_entra_issuer_trailing_slash";

/**
 * Main's unguarded folders after the marker, which main's migration-order check keeps as written.
 * The policy skips them; each is either one statement (atomic) or listed in `HAND_APPLIED_SQL`.
 */
export const RERUNNABLE_EXEMPT_PRISMA = [
  "20261001120001_organization_instant_evals_opt_in",
  "20261001120002_developer_seat",
  "20261002090000_join_request_origin",
  "20261006120001_grant_condition",
  "20261006120002_project_aggregate_rule",
] as const;

/** The two-statement exempt folders a failure may leave half applied, with SQL that ends them. */
const HAND_APPLIED_SQL = new Map<string, readonly string[]>([
  [
    "20261001120001_organization_instant_evals_opt_in",
    [
      `ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "instantEvalsEnabledAt" TIMESTAMP(3);`,
      `ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "instantEvalsEnabledByUserId" TEXT;`,
    ],
  ],
  [
    "20261001120002_developer_seat",
    [
      `ALTER TYPE "OrganizationUserRole" ADD VALUE IF NOT EXISTS 'DEVELOPER';`,
      `ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "joinerRole" "OrganizationUserRole" NOT NULL DEFAULT 'MEMBER';`,
    ],
  ],
]);

/**
 * The SQL a person runs for a folder the upgrade never re-runs because it may be half applied:
 * its statements guarded, then its row recorded applied. Empty for every other folder.
 */
export function findHandAppliedSql({ name }: { name: string }): string[] {
  const statements = HAND_APPLIED_SQL.get(name);
  if (statements === undefined) return [];
  return [
    ...statements,
    `UPDATE "_prisma_migrations" SET "finished_at" = now(), "applied_steps_count" = 1 ` +
      `WHERE "migration_name" = '${name}' AND "finished_at" IS NULL AND "rolled_back_at" IS NULL;`,
  ];
}

/** Whether the upgrade may mark this migration's failed row rolled back and apply it again. */
export function isRerunnablePrismaMigration({ name }: { name: string }): boolean {
  return name > RERUNNABLE_PRISMA_FROM && !HAND_APPLIED_SQL.has(name);
}
