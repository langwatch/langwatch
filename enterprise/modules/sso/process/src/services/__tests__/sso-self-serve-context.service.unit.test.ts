// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { createApiFixture } from "@langwatch/api-fixture";
import type { LicensingApi } from "@langwatch/enterprise-licensing-contract";
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
}: {
  hosted: boolean;
  licensedAtStartup: boolean;
  licensedNow: boolean;
  optedIn?: boolean;
}) {
  const inspectPlatformAccess = vi.fn(async () => ({
    allowed: licensedNow,
    inspections: [],
  }));
  const isHosted = () => hosted;
  const resolver = SsoSelfServeContextService.create({
    authority: LicenseDomainClaimAuthority.create({
      isHosted,
      licensedAtStartup: async () => licensedAtStartup,
    }),
    licenseProof: InstanceLicenseProof.create({
      licensing: createApiFixture<LicensingApi>({ inspectPlatformAccess }),
      instanceLicenseKey: void 0,
    }),
    optIn: { isOptedIn: async () => optedIn },
    isHosted,
  });

  return { resolver, inspectPlatformAccess };
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
    });
    expect(inspectPlatformAccess).not.toHaveBeenCalled();
  });
});
