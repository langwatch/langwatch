import type { SystemMigration, TenantMigrationOutcome } from "@langwatch/system-migrations";

import { IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME } from "../rules/identity-migration-names.rules.ts";
import type { IdentityBackfillService } from "./identity-backfill.service.ts";

/**
 * D01 — the identifier backfill as the runner sees it (ADR-101 §6): the
 * `SystemMigration` contract over `IdentityBackfillService`.
 * Spec: specs/identity/identifier-model.feature.
 */
export class IdentityIdentifierBackfillMigrationService implements SystemMigration {
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
  // The release act the in-place doctrine calls for: the front door depends
  // on an identity history, so every self-hosted user gets one.
  readonly runsAutomaticallyOnSelfHosted = true;
  // Cloud startup includes every user without operator enrollment.
  readonly enrolledAutomatically = true;

  static create(
    backfill: Pick<IdentityBackfillService, "migrateUser">,
  ): IdentityIdentifierBackfillMigrationService {
    return new IdentityIdentifierBackfillMigrationService(backfill);
  }

  private constructor(private readonly backfill: Pick<IdentityBackfillService, "migrateUser">) {}

  async migrateTenant({ tenantId }: { tenantId: string }): Promise<TenantMigrationOutcome> {
    // Nothing here consults `previous`: the pass re-reads the legacy rows
    // and states only what the heads do not carry, so there is no partial
    // state a failed pass could leave behind that a full pass does not redo.
    return this.backfill.migrateUser({ userId: tenantId });
  }
}
