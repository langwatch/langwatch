/**
 * What the Connect settings answer and what they refuse.
 *
 * @see ../connectSettings.service.ts
 * @see ../../../../../src/server/api/routers/connect.ts
 * @see specs/self-hosting/connected-services/connect-settings.feature
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "~/generated/prisma/client";
import { isAuditLogExempt } from "~/server/api/auditLogExemptions";
import { ConnectUnreachableError } from "../connectErrors";
import type {
  ConnectGatewayClient,
  ConnectUsage,
} from "../connectGatewayClient";
import { ConnectSettingsService } from "../connectSettings.service";
import { resetInstanceIdentity } from "../instanceIdentity";
import {
  INSTANCE_ID,
  instanceIdentityTable,
  LANGWATCH_KEYS,
  leaseFor,
  mintLicense,
  NOW,
  tamperedLease,
} from "./installFakes";

// The configuration is stated per test, so what the ambient environment holds
// must not reach the credential. An instance-wide license there would stand in
// for the organization that has none.
vi.mock("~/env.mjs", () => ({ env: {} }));

const ORGANIZATION = "organization-of-record";

const CONFIG_ON = {
  permitted: true,
  gatewayEndpoint: "https://gateway.example.test",
  licenseEndpoint: "https://connect.example.test",
} as const;

const CONFIG_OFF = {
  permitted: false,
  gatewayEndpoint: "https://gateway.example.test",
  licenseEndpoint: "https://connect.example.test",
} as const;

/**
 * A license naming both hosted services, signed by this suite's key pair.
 * Signed rather than hand-built: what the page shows as switched on is read
 * out of the license, and an unsigned blob names nothing.
 */
const LICENSE = mintLicense({
  connectServices: ["instant_evals", "managed_models"],
});
const LICENSE_KEY = LICENSE.licenseKey;
const LICENSE_ID = LICENSE.licenseData.licenseId;

const USAGE: ConnectUsage = {
  services: ["instant_evals", "managed_models"],
  spendAvailable: true,
  readAt: "2026-09-19T12:00:00.000Z",
  contract: {
    id: "budget-contract",
    scope: "organization",
    window: "term",
    capUsd: 1000,
    spentUsd: 120,
    remainingUsd: 880,
    onBreach: "block",
    periodStartedAt: "2026-09-01T00:00:00.000Z",
    isContract: true,
    commitUsd: 1000,
    maximumCapUsd: 1500,
    overageEnabled: true,
    termEndsAt: "2027-09-01T00:00:00.000Z",
  },
  budgets: [],
};

interface Row {
  connectServicesDisabled: string[];
  license: string | null;
  connectLease?: unknown;
  connectLastSyncAt?: Date | null;
  connectLastSyncError?: string | null;
}

function storeWith(row: Row) {
  const update = vi.fn(async () => ({}));
  return {
    update,
    client: {
      organization: {
        findUnique: vi.fn(async () => ({
          connectServicesDisabled: row.connectServicesDisabled,
          license: row.license,
          connectLease: row.connectLease ?? null,
          connectLastSyncAt: row.connectLastSyncAt ?? null,
          connectLastSyncError: row.connectLastSyncError ?? null,
        })),
        update,
      },
      instanceIdentity: instanceIdentityTable(),
    } as unknown as PrismaClient,
  };
}

function fakeClient(
  overrides: Partial<{
    usage: ReturnType<typeof vi.fn>;
    setBudget: ReturnType<typeof vi.fn>;
  }> = {},
) {
  return {
    usage: overrides.usage ?? vi.fn(async () => USAGE),
    setBudget:
      overrides.setBudget ??
      vi.fn(async () => ({ capUsd: 400, maximumCapUsd: 1500 })),
  } as unknown as ConnectGatewayClient;
}

function serviceOver({
  row,
  client,
  config,
  now,
}: {
  row: Row;
  client?: ConnectGatewayClient;
  config?: typeof CONFIG_ON | typeof CONFIG_OFF;
  now?: Date;
}) {
  const store = storeWith(row);
  return {
    store,
    service: new ConnectSettingsService({
      prisma: store.client,
      config: config ?? CONFIG_ON,
      client: client ?? fakeClient(),
      publicKey: LANGWATCH_KEYS.publicKey,
      now: () => now ?? NOW,
    }),
  };
}

/** A lease LangWatch signed for the license and the install above. */
function leaseOfRecord(issuedAt: Date = NOW) {
  return leaseFor({
    licenseId: LICENSE_ID,
    instanceId: INSTANCE_ID,
    seatOverageAllowance: 10,
    issuedAt,
  });
}

function syncOf(status: Awaited<ReturnType<ConnectSettingsService["status"]>>) {
  return status.deployment === "on" ? status.sync : null;
}

beforeEach(() => {
  resetInstanceIdentity();
});

describe("given a deployment with Connect switched off", () => {
  describe("when an admin reads the Connect settings", () => {
    /** @scenario "Connect disabled in the deployment configuration sends nothing" */
    it("says Connect is off for this deployment, and calls nothing", async () => {
      const client = fakeClient();
      const { service } = serviceOver({
        row: { connectServicesDisabled: [], license: LICENSE_KEY },
        client,
        config: CONFIG_OFF,
      });

      await expect(service.status(ORGANIZATION)).resolves.toEqual({
        deployment: "off",
      });
      expect(client.usage).not.toHaveBeenCalled();
    });

    it("refuses a change that could not take effect", async () => {
      const { service, store } = serviceOver({
        row: { connectServicesDisabled: [], license: LICENSE_KEY },
        config: CONFIG_OFF,
      });

      await expect(
        service.setService({
          organizationId: ORGANIZATION,
          service: "instant_evals",
          enabled: true,
        }),
      ).rejects.toMatchObject({ code: "connect_disabled" });
      expect(store.update).not.toHaveBeenCalled();
    });
  });
});

describe("given an organization with no license", () => {
  describe("when an admin reads the Connect settings", () => {
    /** @scenario "An install without a license cannot use Connect" */
    it("reports the deployment as on and the organization as unlicensed", async () => {
      const client = fakeClient();
      const { service } = serviceOver({
        row: { connectServicesDisabled: [], license: null },
        client,
      });

      await expect(service.status(ORGANIZATION)).resolves.toMatchObject({
        deployment: "on",
        licensed: false,
        entitledServices: null,
        usage: null,
        refusal: null,
      });
      expect(client.usage).not.toHaveBeenCalled();
    });
  });
});

describe("given a licensed organization the host answers for", () => {
  describe("when an admin reads the Connect settings", () => {
    /** @scenario "Spend the hosted usage route reports is read into the settings" */
    it("reports the spend, the cap, the remaining credit and what the license includes", async () => {
      const { service } = serviceOver({
        row: { connectServicesDisabled: [], license: LICENSE_KEY },
      });

      const status = await service.status(ORGANIZATION);

      expect(status).toMatchObject({
        deployment: "on",
        gatewayHost: "gateway.example.test",
        licensed: true,
        enabledServices: ["instant_evals", "managed_models"],
        entitledServices: ["instant_evals", "managed_models"],
        refusal: null,
      });
      expect(
        status.deployment === "on" && status.usage?.contract,
      ).toMatchObject({ capUsd: 1000, spentUsd: 120, remainingUsd: 880 });
    });
  });

  describe("when an admin switches a service back on", () => {
    /** @scenario "Switching a service on leaves an audit record" */
    it("clears the refusal, and the mutation is one the audit trail records", async () => {
      const { service, store } = serviceOver({
        row: {
          connectServicesDisabled: ["instant_evals"],
          license: LICENSE_KEY,
        },
      });

      await expect(
        service.setService({
          organizationId: ORGANIZATION,
          service: "instant_evals",
          enabled: true,
        }),
      ).resolves.toEqual({
        enabledServices: ["instant_evals", "managed_models"],
      });
      expect(store.update).toHaveBeenCalledWith({
        where: { id: ORGANIZATION },
        data: { connectServicesDisabled: [] },
      });
      expect(isAuditLogExempt("connect.setService")).toBe(false);
    });
  });

  describe("when an admin switches a service off", () => {
    it("leaves every other service the license names", async () => {
      const { service, store } = serviceOver({
        row: {
          connectServicesDisabled: [],
          license: LICENSE_KEY,
        },
      });

      await expect(
        service.setService({
          organizationId: ORGANIZATION,
          service: "instant_evals",
          enabled: false,
        }),
      ).resolves.toEqual({ enabledServices: ["managed_models"] });
      expect(store.update).toHaveBeenCalledWith({
        where: { id: ORGANIZATION },
        data: { connectServicesDisabled: ["instant_evals"] },
      });
    });
  });

  describe("when an admin sets the cap", () => {
    /** @scenario "The cap an admin sets is carried to the hosted budget route" */
    it("asks the host for it and reports what it confirms", async () => {
      const setBudget = vi.fn(async () => ({
        capUsd: 400,
        maximumCapUsd: 1500,
      }));
      const { service } = serviceOver({
        row: { connectServicesDisabled: [], license: LICENSE_KEY },
        client: fakeClient({ setBudget }),
      });

      await expect(
        service.setCap({ organizationId: ORGANIZATION, capUsd: 400 }),
      ).resolves.toEqual({ capUsd: 400, maximumCapUsd: 1500 });
      expect(setBudget).toHaveBeenCalledWith(
        expect.objectContaining({ capUsd: 400 }),
      );
    });
  });
});

describe("given a license that does not include the service", () => {
  describe("when an admin switches it on", () => {
    /** @scenario "A service the license is not entitled to cannot be switched on" */
    it("is refused, and the service stays switched off", async () => {
      const { service, store } = serviceOver({
        row: { connectServicesDisabled: [], license: LICENSE_KEY },
        client: fakeClient({
          usage: vi.fn(async () => ({ ...USAGE, services: [] })),
        }),
      });

      await expect(
        service.setService({
          organizationId: ORGANIZATION,
          service: "instant_evals",
          enabled: true,
        }),
      ).rejects.toMatchObject({ code: "connect_service_not_entitled" });
      expect(store.update).not.toHaveBeenCalled();
    });
  });
});

describe("given an install whose license syncs", () => {
  const SYNCED_AT = new Date("2026-09-19T06:00:00.000Z");

  describe("when the last sync succeeded", () => {
    /** @scenario "A failing sync is visible from the first failure" */
    it("reports when it succeeded, no failure, and the current lease", async () => {
      const { service } = serviceOver({
        row: {
          connectServicesDisabled: [],
          license: LICENSE_KEY,
          connectLease: leaseOfRecord(),
          connectLastSyncAt: SYNCED_AT,
        },
      });

      expect(syncOf(await service.status(ORGANIZATION))).toEqual({
        lastSyncAt: SYNCED_AT.toISOString(),
        lastError: null,
        lease: {
          seatOverageAllowance: 10,
          warnAfter: "2026-10-03T12:00:00.000Z",
          validUntil: "2026-10-19T12:00:00.000Z",
          state: "fresh",
        },
      });
    });
  });

  describe("when sync has been failing for a day", () => {
    /** @scenario "A failing sync is visible from the first failure" */
    it("reports the failure beside the last success from the first failure", async () => {
      const { service } = serviceOver({
        row: {
          connectServicesDisabled: [],
          license: LICENSE_KEY,
          connectLease: leaseOfRecord(),
          connectLastSyncAt: SYNCED_AT,
          connectLastSyncError: "connect_unreachable",
        },
      });

      expect(syncOf(await service.status(ORGANIZATION))).toMatchObject({
        lastSyncAt: SYNCED_AT.toISOString(),
        lastError: { code: "connect_unreachable" },
      });
    });
  });

  describe("when the lease is past the day admins are warned", () => {
    /** @scenario "Between day 14 and day 30 the allowance is kept and admins are warned" */
    it("reports it as warning, with the day the allowance will be withdrawn", async () => {
      const issuedAt = new Date("2026-09-01T12:00:00.000Z");
      const { service } = serviceOver({
        row: { connectServicesDisabled: [], license: LICENSE_KEY },
        now: new Date("2026-09-20T12:00:00.000Z"),
      });
      const withLease = serviceOver({
        row: {
          connectServicesDisabled: [],
          license: LICENSE_KEY,
          connectLease: leaseOfRecord(issuedAt),
        },
        now: new Date("2026-09-20T12:00:00.000Z"),
      });

      expect(syncOf(await service.status(ORGANIZATION))?.lease).toBeNull();
      expect(
        syncOf(await withLease.service.status(ORGANIZATION))?.lease,
      ).toMatchObject({
        state: "warning",
        validUntil: "2026-10-01T12:00:00.000Z",
      });
    });
  });

  describe("when the lease was edited after signing", () => {
    /** @scenario "A lease that was tampered with is ignored" */
    it("reports no lease at all", async () => {
      const { service } = serviceOver({
        row: {
          connectServicesDisabled: [],
          license: LICENSE_KEY,
          connectLease: tamperedLease(leaseOfRecord()),
        },
      });

      expect(syncOf(await service.status(ORGANIZATION))?.lease).toBeNull();
    });
  });
});

describe("given a host that refuses the read", () => {
  describe("when an admin reads the Connect settings", () => {
    /** @scenario "An unregistered license surfaces as a named error" */
    it("carries the refusal back as data rather than failing the read", async () => {
      const { service } = serviceOver({
        row: { connectServicesDisabled: [], license: LICENSE_KEY },
        client: fakeClient({
          usage: vi.fn(async () => {
            throw new ConnectUnreachableError({
              host: "gateway.example.test",
              port: 443,
            });
          }),
        }),
      });

      await expect(service.status(ORGANIZATION)).resolves.toMatchObject({
        deployment: "on",
        usage: null,
        entitledServices: null,
        refusal: {
          code: "connect_unreachable",
          meta: { host: "gateway.example.test", port: 443 },
        },
      });
    });
  });
});
