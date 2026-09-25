/**
 * The install end of Connect: what a license entitles, what an administrator
 * left switched on, and what never leaves an install that reaches nothing.
 * @see specs/self-hosting/connected-services/connect-settings.feature
 */
import { ConnectBudgetExhaustedError } from "@langwatch/enterprise-licensing-contract";
import { Temporal, type Instant } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import type { ConnectUpstreamSlot } from "../../app/licensing.members.ts";
import { MemoryConnectGatewayChannel } from "../../channels/memory/memory.connect-gateway.channel.ts";
import { TEST_PRIVATE_KEY, TEST_PUBLIC_KEY } from "../../fixtures/license-keys.fixture.ts";
import { MemoryConnectOrganizationRepository } from "../../repositories/memory/memory.connect-organization.repository.ts";
import { MemoryInstanceIdentityRepository } from "../../repositories/memory/memory.instance-identity.repository.ts";
import { ConnectInstallService } from "../connect-install.service.ts";
import { InstanceIdentityService } from "../instance-identity.service.ts";
import { NodeLicenseCryptographyService } from "../node-license-cryptography.service.ts";

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
}: {
  license: string | null;
  servicesDisabled?: string[];
  permitted?: boolean;
  gateway?: MemoryConnectGatewayChannel;
  upstream?: RecordingUpstreamSlot;
}) {
  const organizations = MemoryConnectOrganizationRepository.create([
    {
      organizationId: ORGANIZATION,
      license,
      servicesDisabled,
      lastSyncAt: null,
      lastSyncError: null,
    },
  ]);
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
    publicKey: TEST_PUBLIC_KEY,
    upstream,
  });
  return { service, organizations, gateway, upstream };
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
    const { service, organizations } = install({
      license: licenseNaming(["instant_evals"]),
      servicesDisabled: ["instant_evals"],
    });

    expect(await service.findEnabledServices(ORGANIZATION)).toEqual([]);

    organizations.activate(ORGANIZATION, licenseNaming(["instant_evals"]));
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
    });
  });
});

describe("whether the install as a whole is connected", () => {
  /** @scenario "Product statistics go to the connect host, not the app host" */
  it("is connected once any license on it names a hosted service", async () => {
    const { service } = install({ license: licenseNaming(["instant_evals"]) });

    expect(await service.getDeployment()).toEqual({
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
    const { service, organizations } = install({ license: null });
    organizations.activate("org-second", licenseNaming([]));

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
