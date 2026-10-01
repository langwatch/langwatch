/**
 * Specs: specs/licensing/configured-license-forms.feature and
 * specs/licensing/sso-license-gating.feature
 */
import { createApiFixture } from "@langwatch/api-fixture";
import type { GatewayApi } from "@langwatch/gateway-contract";
import type { InstantEvalApi } from "@langwatch/instant-eval-contract";
import { ResourceScope } from "@langwatch/kernel";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { ScopedSecrets } from "@langwatch/secrets";
import { describe, expect, it } from "vitest";

import { ENTERPRISE_LICENSE_KEY, TEST_LICENSING_CONFIG } from "../../__tests__/testing.ts";
import { MemoryConnectLicenseChannel } from "../../channels/memory/memory.connect-license.channel.ts";
import { MemoryConnectOrganizationRepository } from "../../repositories/memory/memory.connect-organization.repository.ts";
import { MemoryInstanceIdentityRepository } from "../../repositories/memory/memory.instance-identity.repository.ts";
import { LicensingApp } from "../licensing.app.ts";
import type { LicenseStorage, StoredLicense } from "../licensing.members.ts";

const CODE = "LW-A1B2-C3D4-E5F6-G7H8";

class OneOrganizationStorage implements LicenseStorage {
  license: string | null = null;

  async getOrganizationLicense(): Promise<{ licenseKey: string | null }> {
    return { licenseKey: this.license };
  }

  async findOrganizationsWithLicense() {
    return this.license ? [{ organizationId: "org-old", licenseKey: this.license }] : [];
  }

  async organizationExists(): Promise<boolean> {
    return true;
  }

  async storeLicense(_organizationId: string, license: StoredLicense): Promise<void> {
    this.license = license.licenseKey;
  }

  async removeLicense(): Promise<void> {
    this.license = null;
  }

  async getMemberCount(): Promise<number> {
    return 0;
  }

  async getMembersLiteCount(): Promise<number> {
    return 0;
  }
}

async function bootWithConfiguredValue(value: string) {
  const storage = new OneOrganizationStorage();
  const host = MemoryConnectLicenseChannel.create({
    activationAnswer: {
      license: ENTERPRISE_LICENSE_KEY,
      planType: "ENTERPRISE",
      maxMembers: 100,
      expiresAt: "2030-12-31T23:59:59Z",
      services: [],
    },
  });
  const resources = new ResourceScope();
  const app = await LicensingApp.create({
    dependencies: {
      instantEval: createApiFixture<InstantEvalApi>(),
      projects: createApiFixture<ProjectApi>(),
      gateway: createApiFixture<GatewayApi>(),
      organizations: createApiFixture<OrganizationApi>(),
    },
    members: {
      infrastructure: {
        repository: storage,
        configuredAuthProvider: () => null,
        platformSsoAllowed: async () => true,
        authProviderIsMounted: () => true,
        reportSigningFailure: () => {},
        connect: {
          organizations: MemoryConnectOrganizationRepository.create([
            {
              organizationId: "org-old",
              license: null,
              servicesDisabled: [],
              lastSyncAt: null,
              lastSyncError: null,
            },
          ]),
          identity: MemoryInstanceIdentityRepository.create({ seed: { instanceId: "instance-1" } }),
          licenseHost: host,
          instanceLicenseKey: () => undefined,
          newInstanceId: () => "instance-1",
          version: () => "test",
        },
      },
      isSaas: false,
      serviceVersion: "test",
    },
    config: { ...TEST_LICENSING_CONFIG, connectDisabled: false },
    resources,
    secrets: new ScopedSecrets(async (handle, build) =>
      build(handle.id === "LANGWATCH_LICENSE_KEY" ? value : undefined),
    ),
  });
  return { app, host, storage, services: resources.sealServices() };
}

describe("LicensingApp with a configured license value", () => {
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
      const { app, host, storage, services } = await bootWithConfiguredValue(CODE);
      expect(services.map(({ name }) => name)).toEqual(["configured license activation"]);

      for (const service of services) await service.start();

      expect(host.activations).toEqual([{ code: "LWA1B2C3D4E5F6G7H8", instanceId: "instance-1" }]);
      expect(storage.license).toBe(ENTERPRISE_LICENSE_KEY);
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
      expect(host.activations).toEqual([]);
    });
  });
});
