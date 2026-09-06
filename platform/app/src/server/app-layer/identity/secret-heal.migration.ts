import type { IdentitySecretCarryService } from "@langwatch/identity-server";
import type {
  SystemMigration,
  TenantMigrationOutcome,
} from "@langwatch/system-migrations";

/** Its own state-table key, separate from the backfill's on purpose — see
 *  the class docblock. Never rename. */
export const IDENTITY_SECRET_HEAL_MIGRATION_NAME =
  "identity-d01-secret-heal" as const;

/**
 * The reverse leg of the bridge mirror, as a pass (ADR-116 §4).
 *
 * ## Why this is a second migration rather than a step in the first
 *
 * The user this leg exists for is FINALIZED, and `finalized` is terminal:
 * the runner skips a tenant whose record is terminal, so a step inside the
 * identifier backfill would run for held users and never again for the
 * latched ones. But the window the heal leg covers opens exactly AT the
 * latch — for up to the write gate's TTL per pod, and during any gate-cache
 * failure, a finalized user's secret write still lands on the legacy branch
 * while their sign-in reads `AccountCredential`. A password changed in that
 * window is rejected forever unless something copies it back.
 *
 * So this carries its own state row, and that row never becomes terminal: it
 * reports `migrated` on every pass, which is the runner's existing shape for
 * work that is never "done". The cost is one state-row write per user per
 * pass; the alternative is a class of sign-in failure nothing repairs and
 * nothing reports.
 *
 * It retires with the `Account` table in Phase 3, along with the forward leg
 * and the parity check.
 */
export class IdentitySecretHealMigration implements SystemMigration {
  readonly name = IDENTITY_SECRET_HEAL_MIGRATION_NAME;
  readonly title = "Sign-in credential repair";
  readonly description =
    "Keeps each member's stored sign-in credentials in step across the two " +
    "places they can be written during the migration, so a password changed " +
    "at any moment keeps working. Sign-in behavior does not change.";
  readonly requiresOperatorConfirmation = false;
  // Follows the backfill it repairs after: nothing to heal on an
  // installation where no user has latched.
  readonly runsAutomaticallyOnSelfHosted = false;
  // Paced with the backfill it repairs after, for the same reason: a user
  // outside the backfill's cohort has nothing to heal.
  readonly enrolledAutomatically = false;

  constructor(
    private readonly secrets: Pick<IdentitySecretCarryService, "carryForUser">,
  ) {}

  async migrateTenant({
    tenantId,
  }: {
    tenantId: string;
  }): Promise<TenantMigrationOutcome> {
    const outcome = await this.secrets.carryForUser({ userId: tenantId });
    // Deliberately never `finalized`. There is no state in which this user
    // can no longer need repairing — not while both branches can write a
    // secret — so declaring it done would silently stop the pass that keeps
    // their sign-in working.
    return { status: "migrated", report: { kind: "secret_heal", ...outcome } };
  }
}
