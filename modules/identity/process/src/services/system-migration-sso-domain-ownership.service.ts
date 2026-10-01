import type { SystemMigration, TenantMigrationOutcome } from "@langwatch/system-migrations";

import { IDENTITY_SSO_DOMAIN_OWNERSHIP_MIGRATION_NAME } from "../rules/identity-migration-names.rules.ts";
import type { SsoDomainOwnershipBackfillService } from "./sso-domain-ownership-backfill.service.ts";

type Backfill = Pick<SsoDomainOwnershipBackfillService, "backfillOrganization">;

/**
 * The domain-ownership backfill as the runner sees it: the rows a connection
 * folded before the fold wrote them, derived by the fold's own rule. The
 * tenant is an organization. Spec: specs/identity/sso-domain-ownership-backfill.feature.
 */
export class SsoDomainOwnershipMigrationService implements SystemMigration {
  // Never rename: the stable state-table key.
  readonly name = IDENTITY_SSO_DOMAIN_OWNERSHIP_MIGRATION_NAME;
  readonly title = "Single sign-on domain ownership";
  readonly description =
    "Records which organization owns each email domain its single sign-on " +
    "connection has already proved, so sign-ins for those domains reach the " +
    "connection. Domains that were never proved are not affected.";
  // It writes what every fold since the ownership table writes; latching changes nothing.
  readonly requiresOperatorConfirmation = false;
  readonly runsAutomaticallyOnSelfHosted = true;
  readonly enrolledAutomatically = true;

  static create(backfill: Backfill): SsoDomainOwnershipMigrationService {
    return new SsoDomainOwnershipMigrationService(backfill);
  }

  private constructor(private readonly backfill: Backfill) {}

  async migrateTenant({
    tenantId,
    signal,
  }: {
    tenantId: string;
    signal?: AbortSignal;
  }): Promise<TenantMigrationOutcome> {
    const outcome = await this.backfill.backfillOrganization({ organizationId: tenantId, signal });
    const report = { kind: "sso_domain_ownership", ...outcome };
    // A refused connection is a conflict an operator settles; retried each pass until then.
    return outcome.refused.length === 0
      ? { status: "finalized", report }
      : { status: "migrated", report };
  }
}
