import { createApiFixture } from "@langwatch/api-fixture";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { describe, expect, it, vi } from "vitest";

import { DomainClaimAuthorityService } from "../domain-claim-authority.service.ts";

function authorityOver({ isSaas, organizations }: { isSaas: boolean; organizations: number }) {
  const findAllIds = vi.fn(async () => Array.from({ length: organizations }, (_, i) => `org_${i}`));
  const service = DomainClaimAuthorityService.create({
    isSaas,
    licenses: {
      isPlatformSsoLicensed: async () => true,
      findPlatformLicenseDigests: async () => ["sha256:licence"],
    },
    organizations: createApiFixture<OrganizationApi>({ findAllIds }),
  });

  return { service, findAllIds };
}

describe("who the installation's licence speaks for when a domain is claimed", () => {
  describe("when the self-hosted installation holds one organization", () => {
    it("authorizes claims, speaks for its administrator and names the licence's hash", async () => {
      await expect(
        authorityOver({ isSaas: false, organizations: 1 }).service.getDomainClaimAuthority(),
      ).resolves.toEqual({
        authorizesDomainClaims: true,
        hostsSingleOrganization: true,
        licenseDigests: ["sha256:licence"],
      });
    });
  });

  describe("when the self-hosted installation holds several organizations", () => {
    it("does not report a single organization", async () => {
      await expect(
        authorityOver({ isSaas: false, organizations: 2 }).service.getDomainClaimAuthority(),
      ).resolves.toMatchObject({ hostsSingleOrganization: false });
    });
  });

  describe("when the deployment is the hosted service", () => {
    it("authorizes nothing and never counts organizations", async () => {
      const { service, findAllIds } = authorityOver({ isSaas: true, organizations: 1 });

      await expect(service.getDomainClaimAuthority()).resolves.toEqual({
        authorizesDomainClaims: false,
        hostsSingleOrganization: false,
        licenseDigests: [],
      });
      expect(findAllIds).not.toHaveBeenCalled();
    });
  });
});
