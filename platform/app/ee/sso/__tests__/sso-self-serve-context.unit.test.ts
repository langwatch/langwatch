// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { describe, expect, it } from "vitest";
import type { FeatureFlagService } from "~/server/featureFlag/featureFlag.service";
import {
  LicenseDomainClaimAuthority,
  SsoSelfServeContextResolver,
} from "../sso-self-serve-adapters";

const organizationsCounted = (count: number) => ({
  countOrganizations: async () => count,
});

function resolverFor({
  hosted = false,
  organizations,
  operatorIds = [],
}: {
  hosted?: boolean;
  organizations: number;
  operatorIds?: string[];
}) {
  const asked: string[] = [];
  const resolver = new SsoSelfServeContextResolver({
    featureFlags: {
      isEnabled: async () => true,
    } as unknown as FeatureFlagService,
    licenseProof: { currentLicenseKey: async () => null },
    isHosted: () => hosted,
    licenseGate: async () => true,
    licenseAuthority: new LicenseDomainClaimAuthority({
      isHosted: () => hosted,
      organizations: organizationsCounted(organizations),
    }),
    platformOperators: {
      isPlatformOperator: async ({ actorId }) => {
        asked.push(actorId);
        return operatorIds.includes(actorId);
      },
    },
  });
  return { resolver, asked };
}

describe("SsoSelfServeContextResolver", () => {
  describe("when the self-hosted installation holds one organization", () => {
    it("reports a single organization without asking who the actor is", async () => {
      const { resolver, asked } = resolverFor({ organizations: 1 });
      const context = await resolver.resolve({
        organizationId: "org_acme",
        actorId: "user_ana",
      });
      expect(context).toMatchObject({
        deployment: "self-hosted",
        singleOrganization: true,
        actorIsPlatformOperator: false,
      });
      expect(asked).toEqual([]);
    });
  });

  describe("when the self-hosted installation holds several organizations", () => {
    it("asks whether the actor is a platform operator", async () => {
      const { resolver } = resolverFor({
        organizations: 3,
        operatorIds: ["user_olive"],
      });
      await expect(
        resolver.resolve({ organizationId: "org_acme", actorId: "user_olive" }),
      ).resolves.toMatchObject({
        singleOrganization: false,
        actorIsPlatformOperator: true,
      });
      await expect(
        resolver.resolve({ organizationId: "org_acme", actorId: "user_ana" }),
      ).resolves.toMatchObject({ actorIsPlatformOperator: false });
      await expect(
        resolver.resolve({ organizationId: "org_acme", actorId: null }),
      ).resolves.toMatchObject({ actorIsPlatformOperator: false });
    });
  });

  describe("when the deployment is the hosted service", () => {
    it("never reports a single organization or an operator", async () => {
      const { resolver, asked } = resolverFor({
        hosted: true,
        organizations: 1,
        operatorIds: ["user_olive"],
      });
      await expect(
        resolver.resolve({ organizationId: "org_acme", actorId: "user_olive" }),
      ).resolves.toMatchObject({
        deployment: "hosted",
        singleOrganization: false,
        actorIsPlatformOperator: false,
      });
      expect(asked).toEqual([]);
    });
  });
});

describe("LicenseDomainClaimAuthority", () => {
  describe("when asked whether the installation holds a single organization", () => {
    it("answers from the organization count on a self-hosted installation", async () => {
      const one = new LicenseDomainClaimAuthority({
        isHosted: () => false,
        organizations: organizationsCounted(1),
      });
      const two = new LicenseDomainClaimAuthority({
        isHosted: () => false,
        organizations: organizationsCounted(2),
      });
      await expect(one.hostsSingleOrganization()).resolves.toBe(true);
      await expect(two.hostsSingleOrganization()).resolves.toBe(false);
    });

    it("answers no on the hosted service", async () => {
      const hosted = new LicenseDomainClaimAuthority({
        isHosted: () => true,
        organizations: organizationsCounted(1),
      });
      await expect(hosted.hostsSingleOrganization()).resolves.toBe(false);
    });
  });
});
