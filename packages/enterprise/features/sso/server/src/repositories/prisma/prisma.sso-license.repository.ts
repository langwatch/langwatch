// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  SsoLicenseRepository,
  type OrgLicenseCandidate,
} from "../../services/sso-gate.service";
import type { SsoDatabase } from "../../ports/sso-database.port";

/**
 * A candidate organization license row for the SSO gate scan.
 */
/**
 * Pure data-access layer for `anyOrgHasSignedLicense()` — only Prisma
 * queries, no signature verification or business logic (that lives in
 * `sso-gate.ts`, which is the single source of truth for the gate rule).
 *
 * NOTE: `Organization` has no soft-delete/archive column today (verified
 * against `prisma/schema.prisma` — unlike `Team`/`Project`, which use
 * `archivedAt`), so there is nothing to filter out here yet. If a soft-delete
 * field is ever added to `Organization`, exclude it in the `where` clause
 * below so archived orgs can't keep an instance's SSO enabled forever.
 */
export class PrismaSsoLicenseRepository extends SsoLicenseRepository {
  private constructor(private readonly prisma: SsoDatabase) {
    super();
  }

  static create(prisma: SsoDatabase): PrismaSsoLicenseRepository {
    return new PrismaSsoLicenseRepository(prisma);
  }

  async findOrganizationsWithLicense(): Promise<OrgLicenseCandidate[]> {
    const orgs = await this.prisma.organization.findMany({
      where: { license: { not: null } },
      select: { id: true, license: true },
    });
    // `license` is filtered `not: null` above, but Prisma's generated type
    // still reports it as nullable — narrow it here for callers.
    return orgs.filter(
      (org): org is { id: string; license: string } => org.license !== null,
    );
  }
}
