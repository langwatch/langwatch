import type { DomainClaimLicenseAuthority } from "@langwatch/enterprise-licensing-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";

import type { LicenseService } from "./license.service.ts";

export interface DomainClaimAuthorityDeps {
  isSaas: boolean;
  licenses: Pick<LicenseService, "isPlatformSsoLicensed" | "findPlatformLicenseDigests">;
  organizations: Pick<OrganizationApi, "findAllIds">;
}

/**
 * Who the licence speaks for when a single sign-on domain is claimed (sso-onboarding-tiers,
 * tier 2): the installation's operator decides who has an account on it, so with one
 * organization its administrator is that operator; with several, only a platform operator is.
 */
export class DomainClaimAuthorityService {
  static create(deps: DomainClaimAuthorityDeps): DomainClaimAuthorityService {
    return new DomainClaimAuthorityService(deps);
  }

  private constructor(private readonly deps: DomainClaimAuthorityDeps) {}

  /** The hosted service has no installation licence, so it authorizes nothing. */
  async getDomainClaimAuthority(): Promise<DomainClaimLicenseAuthority> {
    if (this.deps.isSaas) {
      return { authorizesDomainClaims: false, hostsSingleOrganization: false, licenseDigests: [] };
    }
    const [authorizesDomainClaims, organizationIds, licenseDigests] = await Promise.all([
      this.deps.licenses.isPlatformSsoLicensed({ isSaas: false }),
      // ponytail: an id scan; a count read on OrganizationApi if installations grow large.
      this.deps.organizations.findAllIds(),
      this.deps.licenses.findPlatformLicenseDigests(),
    ]);

    return {
      authorizesDomainClaims,
      hostsSingleOrganization: organizationIds.length <= 1,
      licenseDigests,
    };
  }
}
