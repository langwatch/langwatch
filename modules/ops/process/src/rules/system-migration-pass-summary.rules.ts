import type { MigrationPassSummary, SystemMigration } from "@langwatch/system-migrations";

/** Both legs count into one summary: the convergence loop stops when a whole
 *  pass moved nothing, so one leg still advancing has to keep it non-zero. */
export function mergeSummaries(
  a: MigrationPassSummary,
  b: MigrationPassSummary,
): MigrationPassSummary {
  return {
    tenantsSeen: a.tenantsSeen + b.tenantsSeen,
    finalized: a.finalized + b.finalized,
    held: a.held + b.held,
    parked: a.parked + b.parked,
    skipped: a.skipped + b.skipped,
    alreadyFinalized: a.alreadyFinalized + b.alreadyFinalized,
    alreadyRolledBack: a.alreadyRolledBack + b.alreadyRolledBack,
    claimed: a.claimed + b.claimed,
    advanced: a.advanced + b.advanced,
    finiteHeld: (a.finiteHeld ?? 0) + (b.finiteHeld ?? 0),
  };
}

type MigrationDeclaration = Pick<
  SystemMigration,
  | "name"
  | "title"
  | "description"
  | "requiresOperatorConfirmation"
  | "runsAutomaticallyOnSelfHosted"
  | "enrolledAutomatically"
> & { tenant: "organization" | "user" };

/** What the migrations page reads of one migration: its declaration plus its tenant axis. */
export function declarationOf({
  migration,
  tenant,
}: {
  migration: SystemMigration;
  tenant: "organization" | "user";
}): MigrationDeclaration {
  return {
    name: migration.name,
    title: migration.title,
    description: migration.description,
    requiresOperatorConfirmation: migration.requiresOperatorConfirmation,
    runsAutomaticallyOnSelfHosted: migration.runsAutomaticallyOnSelfHosted,
    enrolledAutomatically: migration.enrolledAutomatically,
    tenant,
  };
}
