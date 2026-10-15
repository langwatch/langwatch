import type { DomainClaimLicenseAuthority } from "@langwatch/enterprise-licensing-contract";

import type { ConnectOrganizationRepository } from "../repositories/connect-organization.repository.ts";
import type { LicenseService } from "./license.service.ts";

interface DomainClaimAuthorityDeps {
  isSaas: boolean;
  licenses: Pick<LicenseService, "isPlatformSsoLicensed" | "findPlatformLicenseDigests">;
  organizations: Pick<ConnectOrganizationRepository, "findAllOldestFirst">;
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
    const [authorizesDomainClaims, organizations, licenseDigests] = await Promise.all([
      this.deps.licenses.isPlatformSsoLicensed({ isSaas: false }),
      // Read through organization's share (R40, Q9); a self-hosted install holds few.
      this.deps.organizations.findAllOldestFirst(),
      this.deps.licenses.findPlatformLicenseDigests(),
    ]);

    return {
      authorizesDomainClaims,
      hostsSingleOrganization: organizations.length <= 1,
      licenseDigests,
    };
  }
}
