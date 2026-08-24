import type { SsoConnectionGrandfatherService } from "@langwatch/identity-server";
import type {
  SystemMigration,
  TenantMigrationOutcome,
} from "@langwatch/system-migrations";
import { IDENTITY_CONNECTION_GRANDFATHER_MIGRATION_NAME } from "./migration-name";

/**
 * D04 — the connection grandfather as the runner sees it (ADR-117 §5): the
 * `SystemMigration` contract over `@langwatch/identity-server`'s
 * SsoConnectionGrandfatherService, which owns the pass. The runner's shape
 * stays the app's, the way AuthzEngineMigration and the D01 identifier
 * backfill keep it for their domains.
 *
 * Tenant = ORGANIZATION, so it rides the organization-rooted leg of the pass
 * (the D01 backfill is the user-rooted one). Finalization means the routing
 * proof agreed for every domain the organization carries; a disagreement
 * HOLDS the organization with those domains named, and a later pass re-proves
 * it. Held is not failed, and nothing about the organization's sign-in
 * changes either way — `SSOCONN_ROUTING` is what would change it, and it
 * ships `off`.
 *
 * Spec: specs/identity/sso-connection-lifecycle.feature ("A legacy SSO
 * organization is grandfathered without noticing").
 */
export class IdentitySsoConnectionGrandfatherMigration
  implements SystemMigration
{
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

  constructor(
    private readonly grandfather: Pick<
      SsoConnectionGrandfatherService,
      "migrateOrganization"
    >,
  ) {}

  async migrateTenant({
    tenantId,
  }: {
    tenantId: string;
  }): Promise<TenantMigrationOutcome> {
    // Nothing here consults `previous`: the pass re-derives the same command
    // id from the organization and the guard states nothing for a connection
    // that already exists, so there is no partial state a failed pass could
    // leave behind that a full pass does not redo.
    return this.grandfather.migrateOrganization({ organizationId: tenantId });
  }
}
