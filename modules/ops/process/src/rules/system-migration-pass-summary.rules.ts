import type { MigrationPassSummary } from "@langwatch/system-migrations";
import type { TenantMigrationStep } from "@langwatch/upgrade/step";

/** A pass that drove nothing: where every leg's summary is merged into. */
export const NO_PASS_SUMMARY: MigrationPassSummary = {
  tenantsSeen: 0,
  finalized: 0,
  held: 0,
  parked: 0,
  skipped: 0,
  alreadyFinalized: 0,
  alreadyRolledBack: 0,
  claimed: 0,
  advanced: 0,
};

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
  };
}

type MigrationDeclaration = Pick<
  TenantMigrationStep,
  | "title"
  | "description"
  | "requiresOperatorConfirmation"
  | "runsAutomaticallyOnSelfHosted"
  | "enrolledAutomatically"
> & { name: string; tenant: "organization" | "user"; migratedIsSteady: boolean };

/**
 * What the migrations page reads of one declared tenant step, keyed by its id. A project step is
 * not listed: the page acts per organization or per member, never per project.
 */
export function declarationsOf({
  steps,
}: {
  steps: readonly TenantMigrationStep[];
}): MigrationDeclaration[] {
  return steps.flatMap((step) =>
    step.tenants === "project"
      ? []
      : [
          {
            name: step.id,
            title: step.title,
            description: step.description,
            requiresOperatorConfirmation: step.requiresOperatorConfirmation,
            runsAutomaticallyOnSelfHosted: step.runsAutomaticallyOnSelfHosted,
            enrolledAutomatically: step.enrolledAutomatically,
            migratedIsSteady: step.migratedIsSteady ?? false,
            tenant: step.tenants,
          },
        ],
  );
}
