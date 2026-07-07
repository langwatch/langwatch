import type { PrismaClient } from "@prisma/client";

/**
 * A candidate organization license row for the SSO gate scan.
 */
export interface OrgLicenseCandidate {
  id: string;
  license: string;
}

/**
 * Repository interface for the SSO platform gate (ADR-027). Defines the
 * contract for reading candidate organization licenses — allows the gate
 * service to stay Prisma-free (strict 3-layer) and makes DB-error scenarios
 * trivially mockable in tests.
 */
export interface ISsoLicenseRepository {
  findOrganizationsWithLicense(): Promise<OrgLicenseCandidate[]>;
}

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
export class SsoLicenseRepository implements ISsoLicenseRepository {
  constructor(private readonly prisma: PrismaClient) {}

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
