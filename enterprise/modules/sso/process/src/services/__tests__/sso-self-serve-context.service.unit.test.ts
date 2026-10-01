import type { LicensingApi } from "@langwatch/enterprise-licensing-contract";
// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import {
  InstanceLicenseProof,
  LicenseDomainClaimAuthority,
  SsoSelfServeContextService,
} from "../sso-self-serve-context.service.ts";

const ORGANIZATION_ID = "org_acme";

function resolverOver({
  hosted,
  licensedAtStartup,
  licensedNow,
  optedIn = false,
  organizations = 1,
  operatorIds = [],
}: {
  hosted: boolean;
  licensedAtStartup: boolean;
  licensedNow: boolean;
  optedIn?: boolean;
  organizations?: number;
  operatorIds?: string[];
}) {
  const inspectPlatformAccess = vi.fn(async () => ({
    allowed: licensedNow,
    inspections: [],
  }));
  const asked: string[] = [];
  const isHosted = () => hosted;
  const licensing = createApiFixture<LicensingApi>({
    inspectPlatformAccess,
    getDomainClaimAuthority: async () => ({
      authorizesDomainClaims: licensedAtStartup,
      hostsSingleOrganization: organizations <= 1,
      licenseDigests: [],
    }),
  });
  const resolver = SsoSelfServeContextService.create({
    authority: LicenseDomainClaimAuthority.create({
      isHosted,
      licensedAtStartup: async () => licensedAtStartup,
      licensing,
    }),
    licenseProof: InstanceLicenseProof.create({ licensing }),
    optIn: { isOptedIn: async () => optedIn },
    platformOperators: {
      isPlatformOperator: async ({ actorId }) => {
        asked.push(actorId);
        return operatorIds.includes(actorId);
      },
    },
    isHosted,
  });

  return { resolver, inspectPlatformAccess, asked };
}

describe("which tier an organization's own single sign-on setup runs under", () => {
  it("licenses a self-hosted installation whose gate was open at startup", async () => {
    const { resolver, inspectPlatformAccess } = resolverOver({
      hosted: false,
      licensedAtStartup: true,
      licensedNow: true,
    });

    await expect(resolver.resolve({ organizationId: ORGANIZATION_ID })).resolves.toEqual({
      deployment: "self-hosted",
      licensed: true,
      licenseActivatedSinceStart: false,
      optedIn: false,
      singleOrganization: true,
      actorIsPlatformOperator: false,
    });
    expect(inspectPlatformAccess).not.toHaveBeenCalled();
  });

  it("says a licence arrived after startup rather than that there is none", async () => {
    const { resolver } = resolverOver({
      hosted: false,
      licensedAtStartup: false,
      licensedNow: true,
    });

    await expect(resolver.resolve({ organizationId: ORGANIZATION_ID })).resolves.toMatchObject({
      licensed: false,
      licenseActivatedSinceStart: true,
    });
  });

  /** @scenario "A licence activated while the installation is running takes effect at the next restart" */
  it("keeps setup unavailable until restart, and refuses by the restart reason", async () => {
    const { resolver } = resolverOver({
      hosted: false,
      licensedAtStartup: false,
      licensedNow: true,
    });

    await expect(resolver.availability({ organizationId: ORGANIZATION_ID })).resolves.toEqual({
      available: false,
      refusal: "license_restart_required",
    });
    await expect(
      resolver.assertAvailable({ organizationId: ORGANIZATION_ID }),
    ).rejects.toMatchObject({ code: "sso_license_required" });
  });

  it("leaves an unlicensed installation unlicensed", async () => {
    const { resolver } = resolverOver({
      hosted: false,
      licensedAtStartup: false,
      licensedNow: false,
    });

    await expect(resolver.resolve({ organizationId: ORGANIZATION_ID })).resolves.toMatchObject({
      licensed: false,
      licenseActivatedSinceStart: false,
    });
  });

  it("never lets a licence speak for a hosted organization, and reads its opt-in instead", async () => {
    const { resolver, inspectPlatformAccess } = resolverOver({
      hosted: true,
      licensedAtStartup: true,
      licensedNow: true,
      optedIn: true,
    });

    await expect(resolver.resolve({ organizationId: ORGANIZATION_ID })).resolves.toEqual({
      deployment: "hosted",
      licensed: false,
      licenseActivatedSinceStart: false,
      optedIn: true,
      singleOrganization: false,
      actorIsPlatformOperator: false,
    });
    expect(inspectPlatformAccess).not.toHaveBeenCalled();
  });

  describe("when the licensed self-hosted installation holds one organization", () => {
    it("reports a single organization without asking who the actor is", async () => {
      const { resolver, asked } = resolverOver({
        hosted: false,
        licensedAtStartup: true,
        licensedNow: true,
      });

      await expect(
        resolver.resolve({ organizationId: ORGANIZATION_ID, actorId: "user_ana" }),
      ).resolves.toMatchObject({ singleOrganization: true, actorIsPlatformOperator: false });
      expect(asked).toEqual([]);
    });
  });

  describe("when the licensed self-hosted installation holds several organizations", () => {
    it("asks whether the actor is a platform operator", async () => {
      const { resolver } = resolverOver({
        hosted: false,
        licensedAtStartup: true,
        licensedNow: true,
        organizations: 3,
        operatorIds: ["user_olive"],
      });

      await expect(
        resolver.resolve({ organizationId: ORGANIZATION_ID, actorId: "user_olive" }),
      ).resolves.toMatchObject({ singleOrganization: false, actorIsPlatformOperator: true });
      await expect(
        resolver.resolve({ organizationId: ORGANIZATION_ID, actorId: "user_ana" }),
      ).resolves.toMatchObject({ actorIsPlatformOperator: false });
      await expect(resolver.resolve({ organizationId: ORGANIZATION_ID })).resolves.toMatchObject({
        actorIsPlatformOperator: false,
      });
    });
  });

  describe("when the deployment is the hosted service", () => {
    it("never reports a single organization or an operator", async () => {
      const { resolver, asked } = resolverOver({
        hosted: true,
        licensedAtStartup: true,
        licensedNow: true,
        optedIn: true,
        operatorIds: ["user_olive"],
      });

      await expect(
        resolver.resolve({ organizationId: ORGANIZATION_ID, actorId: "user_olive" }),
      ).resolves.toMatchObject({
        deployment: "hosted",
        singleOrganization: false,
        actorIsPlatformOperator: false,
      });
      expect(asked).toEqual([]);
    });
  });
});
