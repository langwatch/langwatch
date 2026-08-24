import type { IdentityBackfillService } from "@langwatch/identity-server";
import type {
  SystemMigration,
  TenantMigrationOutcome,
} from "@langwatch/system-migrations";
import { IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME } from "./migration-name";

/**
 * D01 — the identifier backfill as the runner sees it (ADR-101 §6): the
 * `SystemMigration` contract over `@langwatch/identity-server`'s
 * IdentityBackfillService, which owns the pass. The runner's shape stays the
 * app's, the way AuthzEngineMigration keeps it for the grants engine — the
 * domain package never couples to the runner package.
 *
 * Tenant = user. Finalization is the LATCH: the adapter's per-user write
 * gate (write-gate.ts) reads exactly this migration's record, so the moment
 * a user finalizes here, their domain-significant better-auth writes start
 * emitting identity events structurally.
 *
 * Spec: specs/identity/identifier-model.feature ("The backfill adopts
 * existing accounts and proves itself per user").
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

  constructor(
    private readonly backfill: Pick<IdentityBackfillService, "migrateUser">,
  ) {}

  async migrateTenant({
    tenantId,
  }: {
    tenantId: string;
  }): Promise<TenantMigrationOutcome> {
    // Nothing here consults `previous`: the pass re-reads the legacy rows
    // and states only what the heads do not carry, so there is no partial
    // state a failed pass could leave behind that a full pass does not redo.
    return this.backfill.migrateUser({ userId: tenantId });
  }
}
