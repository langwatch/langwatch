/**
 * The install end of Connect: what a license entitles, what an administrator
 * left switched on, and what never leaves an install that reaches nothing.
 * @see specs/self-hosting/connected-services/connect-settings.feature
 */
import { createHash, createPublicKey } from "node:crypto";

import { NodeLicenseCryptographyService } from "@langwatch/enterprise-license-signing";
import {
  ConnectBudgetExhaustedError,
  ConnectUnreachableError,
  HostedServiceUnavailableError,
  DEFAULT_LICENSE_PUBLIC_KEY,
} from "@langwatch/enterprise-licensing-contract";
import { Temporal, type Instant } from "@langwatch/time";
import { describe, expect, it, vi } from "vitest";

import {
  TEST_PRIVATE_KEY,
  TEST_PUBLIC_KEY,
} from "../../__tests__/fixtures/license-keys.fixture.ts";
import { MemoryConnectGatewayChannel } from "../../channels/memory/memory.connect-gateway.channel.ts";
import type { ConnectOrganizationRecord } from "../../repositories/connect-organization.repository.ts";
import { MemoryConnectOrganizationRepository } from "../../repositories/memory/memory.connect-organization.repository.ts";
import { MemoryInstanceIdentityRepository } from "../../repositories/memory/memory.instance-identity.repository.ts";
import type { ConnectUpstreamSlot } from "../connect-install.service.ts";
import { ConnectInstallService } from "../connect-install.service.ts";
import { InstanceIdentityService } from "../instance-identity.service.ts";

const NOW: Instant = Temporal.Instant.from("2026-01-01T00:00:00.000Z");
const ORGANIZATION = "org-acme";

const cryptography = NodeLicenseCryptographyService.create({ publicKey: TEST_PUBLIC_KEY });

/** A license signed here, so the services it names are part of the signature. */
function licenseNaming(services: string[]): string {
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
          maxMembers: 50,
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

/** The install gateway's hosted provider slot, as licensing last left it. */
class RecordingUpstreamSlot implements ConnectUpstreamSlot {
  current: Parameters<ConnectUpstreamSlot["set"]>[0] | null = null;

  async set(slot: Parameters<ConnectUpstreamSlot["set"]>[0]): Promise<void> {
    this.current = slot;
  }

  async clear(): Promise<void> {
    this.current = null;
  }
}

function install({
  license,
  servicesDisabled = [],
  permitted = true,
  gateway = MemoryConnectGatewayChannel.create(),
  upstream = new RecordingUpstreamSlot(),
  override = true,
}: {
  license: string | null;
  servicesDisabled?: string[];
  permitted?: boolean;
  gateway?: MemoryConnectGatewayChannel;
  upstream?: RecordingUpstreamSlot;
  /** Whether LANGWATCH_LICENSE_PUBLIC_KEY names the test key. */
  override?: boolean;
}) {
  const rows = new Map<string, ConnectOrganizationRecord>([
    [
      ORGANIZATION,
      {
        organizationId: ORGANIZATION,
        license,
        servicesDisabled,
        lastSyncAt: null,
        lastSyncError: null,
      },
    ],
  ]);
  const organizations = MemoryConnectOrganizationRepository.create({ rows });
  const service = ConnectInstallService.create({
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
    ...(permitted ? { gateway } : {}),
    instanceLicenseKey: () => void 0,
    ...(override ? { publicKey: TEST_PUBLIC_KEY } : {}),
    upstream,
  });
  return { service, organizations, rows, gateway, upstream };
}

describe("what a self-hosted install may call", () => {
  /** @scenario "A license that names no hosted service reaches nothing" */
  it("names no service and builds no request for an offline license", async () => {
    const { service, gateway } = install({ license: licenseNaming([]) });

    expect(await service.findEntitledServices(ORGANIZATION)).toEqual([]);
    expect(await service.findEnabledServices(ORGANIZATION)).toEqual([]);

    const status = await service.getStatus(ORGANIZATION);
    expect(status).toMatchObject({ deployment: "on", licensed: true });
    expect(gateway.classifications).toEqual([]);
  });

  it("names the service a license was signed over", async () => {
    const { service } = install({ license: licenseNaming(["instant_evals"]) });

    expect(await service.findEntitledServices(ORGANIZATION)).toEqual(["instant_evals"]);
  });

  it("drops a service name this release has no code for", async () => {
    const { service } = install({
      license: licenseNaming(["instant_evals", "time_travel"]),
    });

    expect(await service.findEntitledServices(ORGANIZATION)).toEqual(["instant_evals"]);
  });

  /** @scenario "A service switched off stays off when the license is reissued" */
  it("keeps a service off across a licence carrying the same entitlement", async () => {
    const { service, rows } = install({
      license: licenseNaming(["instant_evals"]),
      servicesDisabled: ["instant_evals"],
    });

    expect(await service.findEnabledServices(ORGANIZATION)).toEqual([]);

    activate(rows, ORGANIZATION, licenseNaming(["instant_evals"]));
    expect(await service.findEnabledServices(ORGANIZATION)).toEqual([]);
  });

  /** @scenario "Connect disabled in the deployment configuration sends nothing" */
  it("refuses the entitlement and sends nothing when the deployment switched Connect off", async () => {
    const { service, gateway } = install({
      license: licenseNaming(["instant_evals"]),
      permitted: false,
    });

    expect(await service.getStatus(ORGANIZATION)).toEqual({ deployment: "off" });
    expect(await service.findEntitledServices(ORGANIZATION)).toEqual([]);
    expect(await service.findCredential(ORGANIZATION)).toEqual([]);
    expect(gateway.classifications).toEqual([]);

    await expect(
      service.setService({ organizationId: ORGANIZATION, service: "instant_evals", enabled: true }),
    ).rejects.toMatchObject({ code: "connect_disabled" });
  });
});

describe("switching a hosted service", () => {
  /** @scenario "A service the license is not entitled to cannot be switched on" */
  it("refuses a service the registry does not entitle and leaves it off", async () => {
    const { service, organizations } = install({
      license: licenseNaming(["instant_evals"]),
      servicesDisabled: ["instant_evals"],
      gateway: MemoryConnectGatewayChannel.create({
        usage: {
          services: [],
          spendAvailable: true,
          readAt: NOW.toString(),
          contract: null,
          budgets: [],
        },
      }),
    });

    await expect(
      service.setService({ organizationId: ORGANIZATION, service: "instant_evals", enabled: true }),
    ).rejects.toMatchObject({ code: "connect_service_not_entitled" });

    const row = await organizations.findById(ORGANIZATION);
    expect(row?.servicesDisabled).toEqual(["instant_evals"]);
  });

  /** @scenario Switching a service off is an admin decision that is recorded */
  it("records a refusal rather than a row when a service is switched off", async () => {
    const { service, organizations } = install({ license: licenseNaming(["instant_evals"]) });

    const result = await service.setService({
      organizationId: ORGANIZATION,
      service: "instant_evals",
      enabled: false,
    });

    expect(result.enabledServices).toEqual([]);
    expect((await organizations.findById(ORGANIZATION))?.servicesDisabled).toEqual([
      "instant_evals",
    ]);
  });

  it("refuses any change from an organization holding no licence", async () => {
    const { service } = install({ license: null });

    await expect(
      service.setService({
        organizationId: ORGANIZATION,
        service: "instant_evals",
        enabled: false,
      }),
    ).rejects.toMatchObject({ code: "connect_license_required" });
  });
});

describe("the hosted usage cap", () => {
  /** @scenario "The cap an admin sets is carried to the hosted budget route" */
  it("carries the cap an admin set to the hosted budget route", async () => {
    const { service, gateway } = install({ license: licenseNaming(["instant_evals"]) });

    const result = await service.setCap({ organizationId: ORGANIZATION, capUsd: 250 });

    expect(gateway.capUsd).toBe(250);
    expect(result.capUsd).toBe(250);
  });
});

describe("reading the settings when the host refuses", () => {
  it("carries a refusal back as data rather than failing the page", async () => {
    const refusal = new ConnectBudgetExhaustedError({ capUsd: 100 });
    const { service } = install({
      license: licenseNaming(["instant_evals"]),
      gateway: MemoryConnectGatewayChannel.create({ usage: refusal }),
    });

    const status = await service.getStatus(ORGANIZATION);

    expect(status).toMatchObject({
      deployment: "on",
      licensed: true,
      usage: null,
      refusal: { code: "connect_budget_exhausted" },
      isUsageUnavailable: false,
    });
  });
});

describe("reading the settings when LangWatch cannot be reached", () => {
  describe.each([
    [
      "the host is unreachable",
      () => new ConnectUnreachableError({ host: "gateway.test", port: 443 }),
    ],
    [
      "the host answers with no usable reply",
      () => new HostedServiceUnavailableError({ reasons: [new Error("502 from a proxy")] }),
    ],
    ["the read fails unexpectedly", () => new Error("socket hang up")],
  ])("when %s", (_label, failure) => {
    /** @scenario "A usage read that cannot reach LangWatch shows usage as unavailable" */
    it("reports usage as unavailable instead of a refusal or a failed read", async () => {
      const { service } = install({
        license: licenseNaming(["instant_evals"]),
        gateway: MemoryConnectGatewayChannel.create({ usage: failure() }),
      });

      const status = await service.getStatus(ORGANIZATION);

      expect(status).toMatchObject({
        deployment: "on",
        licensed: true,
        usage: null,
        refusal: null,
        isUsageUnavailable: true,
      });
    });
  });

  it("gives the read a ten second deadline", async () => {
    const gateway = MemoryConnectGatewayChannel.create();
    const usage = vi.spyOn(gateway, "usage");
    const { service } = install({ license: licenseNaming(["instant_evals"]), gateway });

    await service.getStatus(ORGANIZATION);

    expect(usage.mock.calls[0]?.[0].signal).toBeInstanceOf(AbortSignal);
  });
});

describe("reading the settings of an organization with no license", () => {
  /** @scenario An install without a license cannot use Connect */
  it("says it is unlicensed and offers no usage", async () => {
    const { service } = install({ license: null });

    const status = await service.getStatus(ORGANIZATION);

    expect(status).toMatchObject({ licensed: false, usage: null });
  });
});

describe("whether the install as a whole is connected", () => {
  /** @scenario "Product statistics go to the connect host, not the app host" */
  it("is connected once any license on it names a hosted service", async () => {
    const { service } = install({ license: licenseNaming(["instant_evals"]) });

    expect(await service.getDeployment()).toMatchObject({
      permitted: true,
      connected: true,
      licenseEndpoint: "https://connect.langwatch.ai",
      gatewayEndpoint: "https://gateway.langwatch.ai",
    });
  });

  /** @scenario "An install on an offline license keeps its telemetry destination" */
  it("is not connected on an offline license, nor with Connect switched off", async () => {
    const offline = install({ license: licenseNaming([]) });
    const switchedOff = install({ license: licenseNaming(["instant_evals"]), permitted: false });

    expect((await offline.service.getDeployment()).connected).toBe(false);
    expect(await switchedOff.service.getDeployment()).toMatchObject({
      permitted: false,
      connected: false,
    });
  });

  it("names the organizations holding a license for the daily sync", async () => {
    const { service, rows } = install({ license: null });
    activate(rows, "org-second", licenseNaming([]));

    expect(await service.findLicensedOrganizationIds()).toEqual(["org-second"]);
  });
});

describe("the hosted provider slot of the install's own gateway", () => {
  /** @scenario "The install adds the LangWatch provider only when Connect and the service are on" */
  it("carries the license token, the instance id and the gateway endpoint while managed models is on", async () => {
    const { service, upstream } = install({ license: licenseNaming(["managed_models"]) });

    await service.publishUpstream(ORGANIZATION);

    expect(upstream.current).toEqual({
      organizationId: ORGANIZATION,
      baseUrl: "https://gateway.langwatch.ai",
      token: cryptography.getLicenseToken(licenseNaming(["managed_models"])),
      instanceId: "instance-1",
    });
  });

  it("clears the slot once an administrator switches managed models off", async () => {
    const { service, upstream } = install({ license: licenseNaming(["managed_models"]) });
    await service.publishUpstream(ORGANIZATION);
    expect(upstream.current).not.toBeNull();

    await service.setService({
      organizationId: ORGANIZATION,
      service: "managed_models",
      enabled: false,
    });

    expect(upstream.current).toBeNull();
  });

  it("adds nothing where Connect is off, the service is not named, or no license is held", async () => {
    for (const setup of [
      install({ license: licenseNaming(["managed_models"]), permitted: false }),
      install({ license: licenseNaming(["instant_evals"]) }),
      install({ license: null }),
    ]) {
      setup.upstream.current = {
        organizationId: ORGANIZATION,
        baseUrl: "https://stale.example",
        token: "lwl_stale",
        instanceId: "instance-stale",
      };

      await setup.service.publishUpstream(ORGANIZATION);

      expect(setup.upstream.current).toBeNull();
    }
  });
});

/** The first 16 hex characters of the SHA-256 of a PEM public key's DER form. */
function fingerprintOf(pem: string): string {
  const der = createPublicKey(pem).export({ type: "spki", format: "der" });
  return createHash("sha256").update(der).digest("hex").slice(0, 16);
}

/** A genuine license's signature over data it was not signed for. */
function forgedLicense(): string {
  const genuine = cryptography.parseLicenseKey(licenseNaming([]));
  if (!genuine) throw new Error("the fixture license did not parse");
  return cryptography.encodeLicenseKey({
    data: { ...genuine.data, licenseId: "lic-forged" },
    signature: genuine.signature,
  });
}

describe("the license key the usage report names", () => {
  /** @scenario "The report says whether licenses verify against the embedded key or an override" */
  it("reports an override where the deployment names a public key", async () => {
    const { service } = install({ license: null });

    expect((await service.getDeployment()).licenseKeySource).toBe("override");
  });

  /** @scenario "The report says whether licenses verify against the embedded key or an override" */
  it("reports the embedded key where the deployment names none", async () => {
    const { service } = install({ license: null, override: false });

    expect((await service.getDeployment()).licenseKeySource).toBe("embedded");
  });

  /** @scenario "The report fingerprints the verifying key and never carries it" */
  it("fingerprints the key licenses verify against, and never carries it", async () => {
    const override = await install({ license: null }).service.getDeployment();
    const embedded = await install({ license: null, override: false }).service.getDeployment();

    expect(override.licenseKeyFingerprint).toBe(fingerprintOf(TEST_PUBLIC_KEY));
    expect(embedded.licenseKeyFingerprint).toBe(fingerprintOf(DEFAULT_LICENSE_PUBLIC_KEY));
    expect(JSON.stringify(override)).not.toContain("BEGIN PUBLIC KEY");
  });

  /** @scenario "The report names the active license and whether it verified" */
  it("names the license held and reports it verified", async () => {
    const { service } = install({ license: licenseNaming([]) });

    expect(await service.getDeployment()).toMatchObject({
      licenseId: "lic-connect",
      licenseVerified: true,
    });
  });

  /** @scenario "The report names the active license and whether it verified" */
  it("names a license whose signature does not verify, and says so", async () => {
    const { service } = install({ license: forgedLicense() });

    expect(await service.getDeployment()).toMatchObject({
      licenseId: "lic-forged",
      licenseVerified: false,
    });
  });

  /** @scenario "The report names the active license and whether it verified" */
  it("reports neither where the install holds no license", async () => {
    const { service } = install({ license: null });

    expect(await service.getDeployment()).toMatchObject({
      licenseId: null,
      licenseVerified: null,
    });
  });
});

/** Writes a licence onto a Connect row the way activation does. */
function activate(
  rows: Map<string, ConnectOrganizationRecord>,
  organizationId: string,
  license: string,
): void {
  rows.set(organizationId, {
    organizationId,
    servicesDisabled: [],
    lastSyncAt: null,
    lastSyncError: null,
    ...rows.get(organizationId),
    license,
  });
}
