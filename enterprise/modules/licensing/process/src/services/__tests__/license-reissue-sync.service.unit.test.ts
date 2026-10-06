// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * A reissued license travelling from the connect host's registry to the install that holds it.
 * @see specs/self-hosting/connected-services/license-sync.feature
 */
import { NodeLicenseCryptographyService } from "@langwatch/enterprise-license-signing";
import { registryHashForToken } from "@langwatch/gateway-contract";
import { Temporal, type Instant } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import {
  TEST_PRIVATE_KEY,
  TEST_PUBLIC_KEY,
} from "../../__tests__/fixtures/license-keys.fixture.ts";
import { ConnectLicenseChannel } from "../../channels/connect-license.channel.ts";
import { MemoryConnectGatewayChannel } from "../../channels/memory/memory.connect-gateway.channel.ts";
import type { ConnectOrganizationRecord } from "../../repositories/connect-organization.repository.ts";
import type { IssuedLicenseRecord } from "../../repositories/issued-license.repository.ts";
import { MemoryConnectOrganizationRepository } from "../../repositories/memory/memory.connect-organization.repository.ts";
import { MemoryInstanceIdentityRepository } from "../../repositories/memory/memory.instance-identity.repository.ts";
import { MemoryIssuedLicenseRepository } from "../../repositories/memory/memory.issued-license.repository.ts";
import { ConnectCredentialService } from "../connect-credential.service.ts";
import { ConnectInstallService } from "../connect-install.service.ts";
import { InstanceIdentityService } from "../instance-identity.service.ts";
import { LicenseRefreshService } from "../license-refresh.service.ts";
import { LicenseSyncService } from "../license-sync.service.ts";

const NOW: Instant = Temporal.Instant.from("2026-01-01T00:00:00.000Z");
const ORGANIZATION = "org-acme";
const INSTANCE = "instance-1";

const cryptography = NodeLicenseCryptographyService.create({ publicKey: TEST_PUBLIC_KEY });

function licenseOf({ licenseId, maxMembers }: { licenseId: string; maxMembers: number }): string {
  return cryptography.encodeLicenseKey(
    cryptography.signLicense(
      {
        licenseId,
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
        connectServices: ["instant_evals"],
      },
      TEST_PRIVATE_KEY,
    ),
  );
}

async function registryRow(
  overrides: Partial<IssuedLicenseRecord> & { licenseKey: string },
): Promise<IssuedLicenseRecord> {
  const { licenseKey, ...rest } = overrides;
  return {
    id: "license-1",
    licenseId: "lic-1",
    tokenHash: await registryHashForToken(cryptography.getLicenseToken(licenseKey)),
    organizationId: ORGANIZATION,
    organizationName: "ACME",
    email: "ops@example.com",
    planType: "ENTERPRISE",
    maxMembers: 50,
    maxMembersLite: 0,
    issuedAt: Temporal.Instant.from("2025-12-01T00:00:00.000Z"),
    expiresAt: Temporal.Instant.from("2027-01-01T00:00:00.000Z"),
    source: "BACKOFFICE",
    issuedById: "operator-1",
    revokedAt: null,
    revokedById: null,
    revokedReason: null,
    supersededAt: null,
    replacesId: null,
    pendingDeliveryLicense: null,
    services: ["instant_evals"],
    seatRateCents: null,
    seatCurrency: null,
    commitUsdCents: 0,
    overageEnabled: false,
    overageMaxUsdCents: null,
    instanceId: INSTANCE,
    instanceBoundAt: NOW,
    lastSyncAt: null,
    lastSyncVersion: null,
    reportedMembers: null,
    reportedMembersLite: null,
    virtualKeyId: "vk-1",
    seatsRaisedFrom: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...rest,
  };
}

/** The connect host as the install reaches it: the registry's own sync answer, over no wire. */
class RegistryHost extends ConnectLicenseChannel {
  constructor(private readonly sync: LicenseSyncService) {
    super();
  }

  async activate(): Promise<never> {
    throw new Error("a sync never redeems an activation code");
  }

  syncLicense({ credential, version, seats }: Parameters<ConnectLicenseChannel["syncLicense"]>[0]) {
    return this.sync.answer({
      authorization: `Bearer ${credential.token}`,
      instanceId: credential.instanceId,
      body: { version, seats },
    });
  }
}

describe("a reissued license over a sync", () => {
  /** @scenario A reissued license arrives over sync and is applied */
  it("is carried by the answer, verified by the install and stored in place of the old one", async () => {
    const heldBefore = licenseOf({ licenseId: "lic-1", maxMembers: 50 });
    const reissued = licenseOf({ licenseId: "lic-2", maxMembers: 80 });
    const registry = MemoryIssuedLicenseRepository.create([
      await registryRow({ licenseKey: heldBefore }),
      await registryRow({
        licenseKey: reissued,
        id: "license-2",
        licenseId: "lic-2",
        replacesId: "license-1",
        pendingDeliveryLicense: reissued,
        maxMembers: 80,
        virtualKeyId: null,
      }),
    ]);
    const managedKeys = {
      provision: async () => ({ id: "vk-2" }),
      retire: async () => undefined,
      invalidate: async () => undefined,
      setConnectServices: async () => undefined,
      setLicense: async () => undefined,
    };
    const sync = LicenseSyncService.create({
      credentials: ConnectCredentialService.create({
        repository: registry,
        managedKeys,
        cryptography,
        systemActorId: "system",
        now: () => NOW,
      }),
      repository: registry,
      managedKeys,
      rateLimit: { allow: () => Promise.resolve(true) },
      systemActorId: "system",
      now: () => NOW,
    });

    const rows = new Map<string, ConnectOrganizationRecord>([
      [
        ORGANIZATION,
        {
          organizationId: ORGANIZATION,
          license: heldBefore,
          servicesDisabled: [],
          lastSyncAt: null,
          lastSyncError: null,
        },
      ],
    ]);
    const organizations = MemoryConnectOrganizationRepository.create({ rows });
    const stored: string[] = [];
    const refresher = LicenseRefreshService.create({
      install: ConnectInstallService.create({
        organizations,
        identity: InstanceIdentityService.create({
          repository: MemoryInstanceIdentityRepository.create({ now: () => NOW }),
          newInstanceId: () => INSTANCE,
        }),
        cryptography,
        deployment: {
          permitted: true,
          gatewayEndpoint: "https://gateway.langwatch.ai",
          licenseEndpoint: "https://connect.langwatch.ai",
        },
        gateway: MemoryConnectGatewayChannel.create(),
        instanceLicenseKey: () => void 0,
        publicKey: TEST_PUBLIC_KEY,
      }),
      instanceId: async () => INSTANCE,
      organizations,
      seats: { getMemberCount: async () => 53, getMembersLiteCount: async () => 7 },
      licenses: {
        validateAndStoreLicense: async ({ licenseKey }) => {
          const result = cryptography.validateLicense({ licenseKey, publicKey: TEST_PUBLIC_KEY });
          if (!result.valid) return { success: false, error: result.error };
          stored.push(licenseKey);
          rows.set(ORGANIZATION, {
            ...(rows.get(ORGANIZATION) as ConnectOrganizationRecord),
            license: licenseKey,
          });
          return { success: true, planInfo: { maxMembers: result.licenseData.plan.maxMembers } };
        },
      },
      cryptography,
      host: new RegistryHost(sync),
      version: () => "1.42.0",
      now: () => NOW,
    });

    const outcome = await refresher.refresh(ORGANIZATION);

    expect(outcome).toMatchObject({ outcome: "updated", maxMembers: 80 });
    expect(stored).toEqual([reissued]);
    const held = (await organizations.findById(ORGANIZATION))?.license ?? "";
    expect(held).toBe(reissued);
    const page = cryptography.validateLicense({ licenseKey: held, publicKey: TEST_PUBLIC_KEY });
    expect(page.valid && page.licenseData.plan.maxMembers).toBe(80);
    expect((await registry.findById("license-2"))?.pendingDeliveryLicense).toBeNull();
  });
});
