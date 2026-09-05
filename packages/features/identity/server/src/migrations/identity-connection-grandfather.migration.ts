import type { SsoConnectionGrandfatherService } from "../sso-connection-grandfather.service";
import type { SystemMigration, TenantMigrationOutcome } from "@langwatch/system-migrations";
import { IDENTITY_CONNECTION_GRANDFATHER_MIGRATION_NAME } from "../identity-migration-names";

/**
 * D04 — the connection grandfather as the runner sees it (ADR-117 §5): the
 * `SystemMigration` contract over `SsoConnectionGrandfatherService`.
 * Spec: specs/identity/sso-connection-lifecycle.feature.
 */
export class IdentitySsoConnectionGrandfatherMigration implements SystemMigration {
  // Never rename: the stable state-table key.
  readonly name = IDENTITY_CONNECTION_GRANDFATHER_MIGRATION_NAME;
  readonly title = "Enterprise SSO connection history";
  readonly description =
    "Records each organization's existing enterprise sign-in setup as " +
    "connection history, and checks that it routes people exactly where the " +
    "current setup does. Sign-in behavior does not change.";
  // Dark preparation: the connection projection decides nothing until the
  // routing flag is flipped, so finalizing changes nothing customer-visible.
  readonly requiresOperatorConfirmation = false;
  // Ships inert on self-hosted until a release flips this after the cloud
  // rollout has soaked (the in-place doctrine's release act).
  readonly runsAutomaticallyOnSelfHosted = false;
  // The soaking posture on cloud, and the same decision as the flag above
  // for the same reason: this ships dark, so it reaches only the
  // organizations an operator has enrolled, and the rollout widens
  // deliberately. A release flips it once the pass has run for the
  // organizations that existed and must start reaching new ones on its own.
  readonly enrolledAutomatically = false;

  static create(
    grandfather: Pick<SsoConnectionGrandfatherService, "migrateOrganization">,
  ): IdentitySsoConnectionGrandfatherMigration {
    return new IdentitySsoConnectionGrandfatherMigration(grandfather);
  }

  constructor(
    private readonly grandfather: Pick<SsoConnectionGrandfatherService, "migrateOrganization">,
  ) {}

  async migrateTenant({ tenantId }: { tenantId: string }): Promise<TenantMigrationOutcome> {
    // Nothing here consults `previous`: the pass re-derives the same command
    // id from the organization and the guard states nothing for a connection
    // that already exists, so there is no partial state a failed pass could
    // leave behind that a full pass does not redo.
    return this.grandfather.migrateOrganization({ organizationId: tenantId });
  }
}
