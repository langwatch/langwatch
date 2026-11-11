// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * A connected install whose licence term ended, collecting a renewal LangWatch
 * issued after the lapse, and an offline licence that never calls LangWatch.
 * @see specs/licensing/license-renewal.feature
 * @see specs/licensing/license-page-actions.feature
 */
import { NodeLicenseCryptographyService } from "@langwatch/enterprise-license-signing";
import { registryHashForToken } from "@langwatch/gateway-contract";
import { HandledError } from "@langwatch/handled-error";
import { Temporal, type Instant } from "@langwatch/time";
import { describe, expect, it, vi } from "vitest";

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
import { appliedConnectFacts } from "./support/applied-connect-facts.ts";

const NOW: Instant = Temporal.Instant.from("2027-01-02T00:00:00.000Z");
const LAPSED_AT = "2027-01-01T00:00:00.000Z";
const RENEWED_UNTIL = "2028-01-01T00:00:00.000Z";
const ORGANIZATION = "org-acme";
const INSTANCE = "instance-1";

const cryptography = NodeLicenseCryptographyService.create({ publicKey: TEST_PUBLIC_KEY });

function licenseOf({
  licenseId,
  expiresAt,
  connectServices = ["instant_evals"],
}: {
  licenseId: string;
  expiresAt: string;
  connectServices?: string[];
}): string {
  return cryptography.encodeLicenseKey(
    cryptography.signLicense(
      {
        licenseId,
        version: 1,
        organizationName: "ACME",
        email: "ops@example.com",
        issuedAt: "2026-01-01T00:00:00.000Z",
        expiresAt,
        plan: {
          type: "ENTERPRISE",
          name: "Enterprise",
          maxMembers: 50,
          maxMessagesPerMonth: 1_000_000,
          canPublish: true,
        },
        organizationId: ORGANIZATION,
        ...(connectServices.length > 0 ? { connectServices } : {}),
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
    liteSeatsUnlimited: false,
    issuedAt: Temporal.Instant.from("2026-01-01T00:00:00.000Z"),
    expiresAt: Temporal.Instant.from(LAPSED_AT),
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

/** The connect host as the install reaches it: the sync door and answer, over no wire. */
class RegistryHost extends ConnectLicenseChannel {
  readonly syncs: string[] = [];

  constructor(private readonly sync: LicenseSyncService) {
    super();
  }

  async activate(): Promise<never> {
    throw new Error("a sync never redeems an activation code");
  }

  async sendUpgradeDiagnostics(): Promise<never> {
    throw new Error("a sync never sends upgrade diagnostics");
  }

  async syncLicense({
    credential,
    version,
    seats,
  }: Parameters<ConnectLicenseChannel["syncLicense"]>[0]) {
    this.syncs.push(credential.token);
    const caller = await this.sync.verifyForSync({
      bearer: credential.token,
      instanceId: credential.instanceId,
    });
    return this.sync.answer({ caller, body: { version, seats } });
  }
}

const expired = licenseOf({ licenseId: "lic-1", expiresAt: LAPSED_AT });
const renewed = licenseOf({ licenseId: "lic-2", expiresAt: RENEWED_UNTIL });

/** The registry with the expired licence and, when asked, its renewal waiting. */
async function cloud({ renewalWaiting }: { renewalWaiting: boolean }) {
  const registry = MemoryIssuedLicenseRepository.create([
    await registryRow({ licenseKey: expired }),
    ...(renewalWaiting
      ? [
          await registryRow({
            licenseKey: renewed,
            id: "license-2",
            licenseId: "lic-2",
            replacesId: "license-1",
            pendingDeliveryLicense: renewed,
            expiresAt: Temporal.Instant.from(RENEWED_UNTIL),
            virtualKeyId: "vk-2",
          }),
        ]
      : []),
  ]);
  const managedKeys = {
    issue: vi.fn(async () => undefined),
    retire: vi.fn(async () => undefined),
    invalidate: vi.fn(async () => undefined),
    setConnectServices: vi.fn(async () => undefined),
    setLicense: vi.fn(async () => undefined),
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
  return { registry, managedKeys, sync };
}

/** One install holding `license`, synced against `host`. */
function install({ license, host }: { license: string; host?: ConnectLicenseChannel }) {
  const rows = new Map<string, ConnectOrganizationRecord>([
    [
      ORGANIZATION,
      {
        organizationId: ORGANIZATION,
        license,
        servicesDisabled: [],
        lastSyncAt: null,
        lastSyncError: null,
      },
    ],
  ]);
  const organizations = MemoryConnectOrganizationRepository.create({ rows });
  const gateway = MemoryConnectGatewayChannel.create();
  const connect = ({ permitted }: { permitted: boolean }) =>
    ConnectInstallService.create({
      organizations,
      facts: appliedConnectFacts(rows),
      identity: InstanceIdentityService.create({
        repository: MemoryInstanceIdentityRepository.create({ now: () => NOW }),
        newInstanceId: () => INSTANCE,
      }),
      cryptography,
      deployment: {
        permitted,
        gatewayEndpoint: "https://gateway.langwatch.ai",
        licenseEndpoint: "https://connect.langwatch.ai",
      },
      gateway,
      instanceLicenseKey: () => void 0,
      publicKey: TEST_PUBLIC_KEY,
    });
  const refresher = LicenseRefreshService.create({
    install: connect({ permitted: true }),
    instanceId: async () => INSTANCE,
    facts: appliedConnectFacts(rows),
    seats: { getMemberCount: async () => 12, getMembersLiteCount: async () => 1 },
    licenses: {
      validateAndStoreLicense: async ({ licenseKey }) => {
        const result = cryptography.validateLicense({ licenseKey, publicKey: TEST_PUBLIC_KEY });
        if (!result.valid) return { success: false, error: result.error };
        rows.set(ORGANIZATION, {
          ...(rows.get(ORGANIZATION) as ConnectOrganizationRecord),
          license: licenseKey,
        });
        return { success: true, planInfo: { maxMembers: result.licenseData.plan.maxMembers } };
      },
    },
    cryptography,
    ...(host ? { host } : {}),
    version: () => "3.30.0",
    now: () => NOW,
    wait: async () => undefined,
  });
  return { organizations, refresher, gateway, connect };
}

async function refusalCodeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    return HandledError.isHandled(error) ? error.code : "unhandled";
  }
  return undefined;
}

describe("a connected licence whose term ended", () => {
  describe("given LangWatch reissued it after the lapse", () => {
    /** @scenario A renewal issued after the licence expired still reaches the install */
    it("collects the renewal over refresh and stores it in place of the expired one", async () => {
      const { sync } = await cloud({ renewalWaiting: true });
      const { refresher, organizations } = install({
        license: expired,
        host: new RegistryHost(sync),
      });

      const outcome = await refresher.refresh(ORGANIZATION);

      expect(outcome).toMatchObject({ outcome: "updated", expiresAt: RENEWED_UNTIL });
      expect((await organizations.findById(ORGANIZATION))?.license).toBe(renewed);
    });

    /** @scenario An expired licence collecting its renewal gets no hosted services */
    it("answers no hosted service and leaves the expired licence's managed key alone", async () => {
      const { sync, managedKeys } = await cloud({ renewalWaiting: true });
      const caller = await sync.verifyForSync({
        bearer: cryptography.getLicenseToken(expired),
        instanceId: INSTANCE,
      });

      const answer = await sync.answer({
        caller,
        body: { version: "3.30.0", seats: { members: 12, liteMembers: 1 } },
      });

      expect(answer.services).toEqual([]);
      expect(answer.license).toBe(renewed);
      expect(managedKeys.setConnectServices).not.toHaveBeenCalled();
      expect(managedKeys.setLicense).not.toHaveBeenCalled();
      expect(managedKeys.issue).not.toHaveBeenCalled();
    });

    /** @scenario An expired licence presented by another install collects nothing */
    it("refuses the expired licence from a different install as expired", async () => {
      const { sync } = await cloud({ renewalWaiting: true });

      const code = await refusalCodeOf(
        sync.verifyForSync({
          bearer: cryptography.getLicenseToken(expired),
          instanceId: "instance-2",
        }),
      );

      expect(code).toBe("connect_license_expired");
    });

    /** @scenario An expired licence reaches no other connect route */
    it("is refused as expired by the credential every other connect route checks", async () => {
      const { sync } = await cloud({ renewalWaiting: true });

      const code = await refusalCodeOf(
        sync.verify({ bearer: cryptography.getLicenseToken(expired), instanceId: INSTANCE }),
      );

      expect(code).toBe("connect_license_expired");
    });
  });

  describe("given nothing is waiting for it", () => {
    /** @scenario An expired licence with no renewal waiting is still refused as expired */
    it("refuses the sync as expired and records no seats", async () => {
      const { sync, registry } = await cloud({ renewalWaiting: false });

      const code = await refusalCodeOf(
        sync.verifyForSync({
          bearer: cryptography.getLicenseToken(expired),
          instanceId: INSTANCE,
        }),
      );

      expect(code).toBe("connect_license_expired");
      const row = await registry.findById("license-1");
      expect(row?.lastSyncAt).toBeNull();
      expect(row?.reportedMembers).toBeNull();
    });

    /** @scenario The daily sync keeps running after a connected licence expires */
    it("still calls LangWatch on the daily pass", async () => {
      const { sync } = await cloud({ renewalWaiting: false });
      const host = new RegistryHost(sync);
      const { refresher } = install({ license: expired, host });

      await refresher.syncAll([ORGANIZATION]);

      expect(host.syncs).toEqual([cryptography.getLicenseToken(expired)]);
    });
  });
});

describe("an offline licence", () => {
  /** @scenario Settings, Connect on an offline licence makes no hosted call */
  it("reads the Connect status without calling the gateway", async () => {
    const offline = licenseOf({
      licenseId: "lic-offline",
      expiresAt: RENEWED_UNTIL,
      connectServices: [],
    });
    const { gateway, connect } = install({ license: offline });
    const usage = vi.spyOn(gateway, "usage");

    const status = await connect({ permitted: true }).getStatus(ORGANIZATION);

    expect(usage).not.toHaveBeenCalled();
    expect(status).toMatchObject({ deployment: "on", licensed: false, usage: null });
  });

  /** @scenario Connect disabled makes no hosted call */
  it("makes no call at all when Connect is switched off", async () => {
    const { gateway, connect } = install({ license: renewed });
    const usage = vi.spyOn(gateway, "usage");

    const status = await connect({ permitted: false }).getStatus(ORGANIZATION);

    expect(usage).not.toHaveBeenCalled();
    expect(status).toEqual({ deployment: "off" });
  });
});
