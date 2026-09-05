import type { IdentityBackfillService } from "../identity-backfill.service";
import type { SystemMigration, TenantMigrationOutcome } from "@langwatch/system-migrations";
import { IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME } from "../identity-migration-names";

/**
 * D01 — the identifier backfill as the runner sees it (ADR-101 §6): the
 * `SystemMigration` contract over `IdentityBackfillService`.
 * Spec: specs/identity/identifier-model.feature.
 */
export class IdentityIdentifierBackfillMigration implements SystemMigration {
  // Never rename: the stable state-table key. The write gate reads exactly
  // this record, so the latch and the migration share the one constant.
  readonly name = IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME;
  readonly title = "Identifier history backfill";
  readonly description =
    "Records each member's existing sign-in methods as identity history and " +
    "verifies the recorded data matches their accounts. Sign-in behavior " +
    "does not change.";
  // Dark preparation: finalization opens event EMISSION for the user; no
  // decision, no sign-in behavior and nothing customer-visible changes.
  readonly requiresOperatorConfirmation = false;
  // Ships inert on self-hosted until a release flips this after the cloud
  // rollout has soaked (the in-place doctrine's release act).
  readonly runsAutomaticallyOnSelfHosted = false;
  // Still soaking on cloud: the identity rollout is paced by enrollment, so
  // deploying this changes nothing until an operator enrolls an
  // organization. Flip it only once the rollout is finished and the
  // remaining question is reaching tenants created since.
  readonly enrolledAutomatically = false;

  static create(
    backfill: Pick<IdentityBackfillService, "migrateUser">,
  ): IdentityIdentifierBackfillMigration {
    return new IdentityIdentifierBackfillMigration(backfill);
  }

  constructor(private readonly backfill: Pick<IdentityBackfillService, "migrateUser">) {}

  async migrateTenant({ tenantId }: { tenantId: string }): Promise<TenantMigrationOutcome> {
    // Nothing here consults `previous`: the pass re-reads the legacy rows
    // and states only what the heads do not carry, so there is no partial
    // state a failed pass could leave behind that a full pass does not redo.
    return this.backfill.migrateUser({ userId: tenantId });
  }
}
