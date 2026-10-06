import type { SystemMigration, TenantMigrationOutcome } from "@langwatch/system-migrations";

import { IDENTITY_CONNECTION_GRANDFATHER_MIGRATION_NAME } from "../rules/identity-migration-names.rules.ts";
import type { SsoConnectionGrandfatherService } from "./sso-connection-grandfather.service.ts";

/**
 * D04, the connection grandfather as the runner sees it (ADR-117 §5): the `SystemMigration`
 * contract over `SsoConnectionGrandfatherService`. Tenant = organization; a routing
 * disagreement holds it, and sign-in never changes either way.
 */
export class IdentityConnectionGrandfatherMigrationService implements SystemMigration {
  // Never rename: the stable state-table key.
  readonly name = IDENTITY_CONNECTION_GRANDFATHER_MIGRATION_NAME;
  readonly title = "Enterprise SSO connection history";
  readonly description =
    "Records each organization's existing enterprise sign-in setup as " +
    "connection history, and checks that it routes people exactly where the " +
    "current setup does. Sign-in behavior does not change.";
  // Dark preparation: the connection projection decides nothing until the routing flag flips.
  readonly requiresOperatorConfirmation = false;
  // Main: startup runs it on its own, with no enrollment or preparatory release.
  readonly runsAutomaticallyOnSelfHosted = true;
  readonly enrolledAutomatically = true;

  static create(
    grandfather: Pick<SsoConnectionGrandfatherService, "migrateOrganization">,
  ): IdentityConnectionGrandfatherMigrationService {
    return new IdentityConnectionGrandfatherMigrationService(grandfather);
  }

  private constructor(
    private readonly grandfather: Pick<SsoConnectionGrandfatherService, "migrateOrganization">,
  ) {}

  async migrateTenant({ tenantId }: { tenantId: string }): Promise<TenantMigrationOutcome> {
    // The pass re-derives the same command id per organization, so a repeat is a no-op.
    return this.grandfather.migrateOrganization({ organizationId: tenantId });
  }
}
