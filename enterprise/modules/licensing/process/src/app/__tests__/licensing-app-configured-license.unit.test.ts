/**
 * Specs: specs/licensing/configured-license-forms.feature and
 * specs/licensing/sso-license-gating.feature
 */
import type { GatewayApi } from "@langwatch/gateway-contract";
import { ResourceScope } from "@langwatch/process";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createTestLicensingApp, ENTERPRISE_LICENSE_KEY } from "../../__tests__/testing.ts";
import { ScriptedConnectHost } from "../../channels/__tests__/support/scripted-connect-fetch.ts";
import { MemoryConnectOrganizationRepository } from "../../repositories/memory/memory.connect-organization.repository.ts";
import { MemoryInstanceIdentityRepository } from "../../repositories/memory/memory.instance-identity.repository.ts";
import { MemoryOrganizationLicenseRepository } from "../../repositories/memory/memory.organization-license.repository.ts";

const CODE = "LW-A1B2-C3D4-E5F6-G7H8";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The Connect host the install redeems at, reached over the runtime's own fetch. */
function connectHost(): ScriptedConnectHost {
  const host = new ScriptedConnectHost().answers(200, {
    license: ENTERPRISE_LICENSE_KEY,
    planType: "ENTERPRISE",
    maxMembers: 100,
    expiresAt: "2030-12-31T23:59:59Z",
    services: [],
  });
  vi.stubGlobal("fetch", host.fetch);
  return host;
}

/** What reached the host's activation route: the code it carried and the install it named. */
function activations(host: ScriptedConnectHost) {
  return host.sent
    .filter(({ url }) => url.endsWith("/v1/license/activate"))
    .map(({ headers }) => ({
      code: headers.authorization?.replace(/^Bearer /, ""),
      instanceId: headers["x-langwatch-instance"],
    }));
}

async function bootWithConfiguredValue(value: string) {
  const host = connectHost();
  const licenses = MemoryOrganizationLicenseRepository.create(new Map([["org-old", null]]));
  const resources = new ResourceScope();
  const app = await createTestLicensingApp({
    repositories: {
      organizationLicenses: licenses,
      connectOrganizations: MemoryConnectOrganizationRepository.create({
        rows: new Map([
          [
            "org-old",
            {
              organizationId: "org-old",
              license: null,
              servicesDisabled: [],
              lastSyncAt: null,
              lastSyncError: null,
            },
          ],
        ]),
      }),
      instanceIdentity: MemoryInstanceIdentityRepository.create({
        seed: { instanceId: "instance-1" },
      }),
    },
    dependencies: {
      gateway: createApiFixture<GatewayApi>({
        setConnectUpstreamInternal: async () => undefined,
        clearConnectUpstreamInternal: async () => undefined,
      }),
    },
    config: { connectDisabled: false },
    secrets: { LANGWATCH_LICENSE_KEY: value },
    resources,
  });
  const storedLicense = async () => (await licenses.getOrganizationLicense("org-old")).licenseKey;
  return { app, host, storedLicense, services: resources.sealServices() };
}

describe("LicensingModule with a configured license value", () => {
  describe("given LANGWATCH_LICENSE_KEY holds an activation code", () => {
    /** @scenario "an activation code in the license variable is not read as a license" */
    it("never inspects the code as an instance license", async () => {
      const { app } = await bootWithConfiguredValue(CODE);

      const access = await app.inspectPlatformAccess();

      expect(access.allowed).toBe(false);
      expect(access.inspections.map(({ source }) => source)).not.toContain("instance");
    });

    /** @scenario "an activation code in the license variable is redeemed at boot" */
    it("redeems it at start with this install's instance id and stores the license", async () => {
      const { app, host, storedLicense, services } = await bootWithConfiguredValue(CODE);
      expect(services.map(({ name }) => name)).toEqual(["configured license activation"]);

      for (const service of services) await service.start();

      expect(activations(host)).toEqual([{ code: "LWA1B2C3D4E5F6G7H8", instanceId: "instance-1" }]);
      expect(await storedLicense()).toBe(ENTERPRISE_LICENSE_KEY);
      expect(await app.inspectPlatformAccess()).toMatchObject({ allowed: true });
    });

    /** @scenario "Activating a license turns SSO on without a restart" */
    it("turns platform SSO on in this process as soon as the license is stored", async () => {
      const { app, services } = await bootWithConfiguredValue(CODE);
      expect(await app.isPlatformSsoLicensed()).toBe(false);
      const before = await app.licenseRevision();

      for (const service of services) await service.start();

      expect(await app.licenseRevision()).not.toBe(before);
      expect(await app.isPlatformSsoLicensed()).toBe(true);
    });
  });

  describe("given LANGWATCH_LICENSE_KEY holds a signed license key", () => {
    it("reads it as the instance license and registers no redemption", async () => {
      const { app, host, services } = await bootWithConfiguredValue(ENTERPRISE_LICENSE_KEY);

      expect(services).toEqual([]);
      expect(await app.inspectPlatformAccess()).toMatchObject({ allowed: true });
      expect(activations(host)).toEqual([]);
    });
  });
});
