/**
 * The install end of the license sync: what leaves the install, and what a
 * delivered replacement does when it lands.
 * @see specs/self-hosting/connected-services/license-sync.feature
 */
import { Temporal, type Instant } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { MemoryConnectGatewayChannel } from "../../channels/memory/memory.connect-gateway.channel.ts";
import { MemoryConnectLicenseChannel } from "../../channels/memory/memory.connect-license.channel.ts";
import { TEST_PRIVATE_KEY, TEST_PUBLIC_KEY } from "../../fixtures/license-keys.fixture.ts";
import { MemoryConnectOrganizationRepository } from "../../repositories/memory/memory.connect-organization.repository.ts";
import { MemoryInstanceIdentityRepository } from "../../repositories/memory/memory.instance-identity.repository.ts";
import { ConnectInstallService } from "../connect-install.service.ts";
import { InstanceIdentityService } from "../instance-identity.service.ts";
import { LicenseRefreshService } from "../license-refresh.service.ts";
import { NodeLicenseCryptographyService } from "../node-license-cryptography.service.ts";

const NOW: Instant = Temporal.Instant.from("2026-01-01T00:00:00.000Z");
const ORGANIZATION = "org-acme";

const cryptography = NodeLicenseCryptographyService.create({ publicKey: TEST_PUBLIC_KEY });

function licenseNaming({
  services,
  maxMembers = 50,
}: {
  services: string[];
  maxMembers?: number;
}): string {
  return cryptography.encodeLicenseKey(
    cryptography.signLicense(
      {
        licenseId: "lic-connect",
        version: 1,
        organizationName: "ACME",
        email: "ops@example.com",
        issuedAt: "2025-12-01T00:00:00.000Z",
        expiresAt: "2027-01-01T00:00:00.000Z",
        plan: {
          type: "ENTERPRISE",
          name: "Enterprise",
          maxMembers,
          maxMessagesPerMonth: 1_000_000,
          canPublish: true,
        },
        organizationId: ORGANIZATION,
        ...(services.length > 0 ? { connectServices: services } : {}),
      },
      TEST_PRIVATE_KEY,
    ),
  );
}

function refresher({
  license,
  host = MemoryConnectLicenseChannel.create(),
  permitted = true,
}: {
  license: string | null;
  host?: MemoryConnectLicenseChannel;
  permitted?: boolean;
}) {
  const organizations = MemoryConnectOrganizationRepository.create([
    {
      organizationId: ORGANIZATION,
      license,
      servicesDisabled: [],
      lastSyncAt: null,
      lastSyncError: null,
    },
  ]);
  const install = ConnectInstallService.create({
    organizations,
    identity: InstanceIdentityService.create({
      repository: MemoryInstanceIdentityRepository.create({ now: () => NOW }),
      newInstanceId: () => "instance-1",
    }),
    cryptography,
    deployment: {
      permitted,
      gatewayEndpoint: "https://gateway.langwatch.ai",
      licenseEndpoint: "https://connect.langwatch.ai",
    },
    ...(permitted ? { gateway: MemoryConnectGatewayChannel.create() } : {}),
    instanceLicenseKey: () => void 0,
    publicKey: TEST_PUBLIC_KEY,
  });
  const stored: string[] = [];
  const service = LicenseRefreshService.create({
    install,
    instanceId: async () => "instance-1",
    organizations,
    seats: {
      getMemberCount: async () => 53,
      getMembersLiteCount: async () => 7,
    },
    licenses: {
      validateAndStoreLicense: async ({ licenseKey }) => {
        const result = cryptography.validateLicense({
          licenseKey,
          publicKey: TEST_PUBLIC_KEY,
        });
        if (!result.valid) return { success: false, error: result.error };
        stored.push(licenseKey);
        organizations.activate(ORGANIZATION, licenseKey);
        return { success: true, planInfo: { maxMembers: result.licenseData.plan.maxMembers } };
      },
    },
    cryptography,
    ...(permitted ? { host } : {}),
    version: () => "1.42.0",
    now: () => NOW,
  });
  return { service, organizations, host, stored };
}

describe("what leaves the install on a sync", () => {
  /** @scenario "The sync sends the fixed license payload and nothing else" */
  it("sends the token, the instance id, the version and both seat counts", async () => {
    const { service, host } = refresher({
      license: licenseNaming({ services: ["instant_evals"] }),
    });

    await service.refresh(ORGANIZATION);

    expect(host.syncs).toEqual([
      {
        token: cryptography.getLicenseToken(licenseNaming({ services: ["instant_evals"] })),
        instanceId: "instance-1",
        version: "1.42.0",
        seats: { members: 53, liteMembers: 7 },
      },
    ]);
  });

  /** @scenario "The instance id on sync is the one the gateway sees" */
  it("presents the identity the hosted services are given", async () => {
    const { service, host } = refresher({
      license: licenseNaming({ services: ["instant_evals"] }),
    });

    await service.refresh(ORGANIZATION);

    expect(host.syncs[0]?.instanceId).toBe("instance-1");
  });

  /** @scenario "An install without a license sends no sync" */
  it("sends nothing for an organization holding no license", async () => {
    const { service, host } = refresher({ license: null });

    await service.syncAll([ORGANIZATION]);

    expect(host.syncs).toEqual([]);
  });

  it("sends nothing for a license naming no hosted service", async () => {
    const { service, host } = refresher({ license: licenseNaming({ services: [] }) });

    await service.syncAll([ORGANIZATION]);

    expect(host.syncs).toEqual([]);
  });

  /** @scenario "An install with Connect disabled sends no sync" */
  it("sends nothing and refuses a hand-run refresh when Connect is switched off", async () => {
    const { service, host } = refresher({
      license: licenseNaming({ services: ["instant_evals"] }),
      permitted: false,
    });

    await service.syncAll([ORGANIZATION]);
    expect(host.syncs).toEqual([]);

    await expect(service.refresh(ORGANIZATION)).rejects.toMatchObject({
      code: "connect_disabled",
    });
  });
});

describe("a replacement license the answer carried", () => {
  it("applies it and syncs again with the new token", async () => {
    const replacement = licenseNaming({ services: ["instant_evals"], maxMembers: 58 });
    const { service, host, stored } = refresher({
      license: licenseNaming({ services: ["instant_evals"] }),
      host: MemoryConnectLicenseChannel.create({
        syncAnswer: { services: ["instant_evals"], license: replacement },
      }),
    });

    const outcome = await service.refresh(ORGANIZATION);

    expect(outcome).toEqual({
      outcome: "updated",
      maxMembers: 58,
      expiresAt: "2027-01-01T00:00:00.000Z",
    });
    expect(stored).toEqual([replacement]);
    expect(host.syncs.at(-1)?.token).toBe(cryptography.getLicenseToken(replacement));
  });

  /** @scenario "A delivered license that does not verify is not applied" */
  it("does not apply a delivered license that does not verify", async () => {
    const { service, organizations, stored } = refresher({
      license: licenseNaming({ services: ["instant_evals"] }),
      host: MemoryConnectLicenseChannel.create({
        syncAnswer: { services: ["instant_evals"], license: "not-a-license" },
      }),
    });

    await expect(service.refresh(ORGANIZATION)).rejects.toBeInstanceOf(Error);

    expect(stored).toEqual([]);
    expect((await organizations.findById(ORGANIZATION))?.lastSyncError).toBe("license_key_invalid");
  });
});

describe("what a sync leaves behind", () => {
  it("records the moment a sync landed and clears the last failure", async () => {
    const { service, organizations } = refresher({
      license: licenseNaming({ services: ["instant_evals"] }),
    });

    await service.syncAll([ORGANIZATION]);

    const row = await organizations.findById(ORGANIZATION);
    expect(row?.lastSyncAt?.toString()).toBe(NOW.toString());
    expect(row?.lastSyncError).toBeNull();
  });

  it("records the code the host named when a sync is refused", async () => {
    const { service, organizations } = refresher({
      license: licenseNaming({ services: ["instant_evals"] }),
      host: MemoryConnectLicenseChannel.create({
        syncAnswer: new Error("the host was not reached"),
      }),
    });

    await service.syncAll([ORGANIZATION]);

    expect((await organizations.findById(ORGANIZATION))?.lastSyncError).toBe("license_sync_failed");
  });
});

describe("redeeming an activation code on the install", () => {
  /** @scenario "The install stores what the code minted exactly as a pasted license" */
  it("hands the license LangWatch minted back for storing, naming this install", async () => {
    const host = MemoryConnectLicenseChannel.create({
      activationAnswer: {
        license: "minted-license",
        planType: "ENTERPRISE",
        maxMembers: 10,
        expiresAt: "2027-01-01T00:00:00.000Z",
        services: [],
      },
    });
    const { service } = refresher({ license: null, host });
    await expect(service.redeemActivationCode({ code: "LW-ABCD" })).resolves.toEqual({
      licenseKey: "minted-license",
    });
    expect(host.activations).toEqual([{ code: "LW-ABCD", instanceId: "instance-1" }]);
  });

  /** @scenario "An install with connect switched off refuses to redeem" */
  it("refuses by code and calls nothing when Connect is switched off", async () => {
    const host = MemoryConnectLicenseChannel.create();
    const { service } = refresher({ license: null, host, permitted: false });
    await expect(service.redeemActivationCode({ code: "LW-ABCD" })).rejects.toMatchObject({
      code: "connect_disabled",
    });
    expect(host.activations).toEqual([]);
  });
});
