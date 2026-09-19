/**
 * What the Connect settings answer and what they refuse.
 *
 * @see ../connectSettings.service.ts
 * @see ../../../../../src/server/api/routers/connect.ts
 * @see specs/self-hosting/connected-services/connect-settings.feature
 */

import { describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "~/generated/prisma/client";
import { isAuditLogExempt } from "~/server/api/auditLogExemptions";
import { ConnectUnreachableError } from "../connectErrors";
import type {
  ConnectGatewayClient,
  ConnectUsage,
} from "../connectGatewayClient";
import { ConnectSettingsService } from "../connectSettings.service";

// The configuration is stated per test, so what the ambient environment holds
// must not reach the credential. An instance-wide license there would stand in
// for the organization that has none.
vi.mock("~/env.mjs", () => ({ env: {} }));

const ORGANIZATION = "organization-of-record";

const CONFIG_ON = {
  enabled: true,
  gatewayEndpoint: "https://gateway.example.test",
  licenseEndpoint: "https://connect.example.test",
} as const;

const LICENSE_KEY = Buffer.from(
  JSON.stringify({
    data: {
      licenseId: "license-of-record",
      version: 1,
      organizationName: "ACME",
      email: "admin@acme.test",
      issuedAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2027-01-01T00:00:00.000Z",
      plan: {
        type: "enterprise",
        name: "Enterprise",
        maxMembers: 50,
        maxMessagesPerMonth: 1_000_000,
        canPublish: true,
      },
    },
    signature: "not-a-real-signature",
  }),
).toString("base64");

const USAGE: ConnectUsage = {
  services: ["instant_evals"],
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
  connectServices: string[];
  license: string | null;
}

function storeWith(row: Row) {
  const update = vi.fn(async () => ({}));
  return {
    update,
    client: {
      organization: {
        findUnique: vi.fn(async () => ({
          connectServices: row.connectServices,
          license: row.license,
        })),
        update,
      },
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
}: {
  row: Row;
  client?: ConnectGatewayClient;
  config?: typeof CONFIG_ON | { enabled: false };
}) {
  const store = storeWith(row);
  return {
    store,
    service: new ConnectSettingsService({
      prisma: store.client,
      config: config ?? CONFIG_ON,
      client: client ?? fakeClient(),
    }),
  };
}

describe("given a deployment with Connect switched off", () => {
  describe("when an admin reads the Connect settings", () => {
    /** @scenario "Connect disabled in the deployment configuration sends nothing" */
    it("says Connect is off for this deployment, and calls nothing", async () => {
      const client = fakeClient();
      const { service } = serviceOver({
        row: { connectServices: [], license: LICENSE_KEY },
        client,
        config: { enabled: false },
      });

      await expect(service.status(ORGANIZATION)).resolves.toEqual({
        deployment: "off",
      });
      expect(client.usage).not.toHaveBeenCalled();
    });

    it("refuses a change that could not take effect", async () => {
      const { service, store } = serviceOver({
        row: { connectServices: [], license: LICENSE_KEY },
        config: { enabled: false },
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
        row: { connectServices: [], license: null },
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
        row: { connectServices: ["instant_evals"], license: LICENSE_KEY },
      });

      const status = await service.status(ORGANIZATION);

      expect(status).toMatchObject({
        deployment: "on",
        gatewayHost: "gateway.example.test",
        licensed: true,
        enabledServices: ["instant_evals"],
        entitledServices: ["instant_evals"],
        refusal: null,
      });
      expect(
        status.deployment === "on" && status.usage?.contract,
      ).toMatchObject({ capUsd: 1000, spentUsd: 120, remainingUsd: 880 });
    });
  });

  describe("when an admin switches a service on", () => {
    /** @scenario "Switching a service on leaves an audit record" */
    it("writes the opt-in, and the mutation is one the audit trail records", async () => {
      const { service, store } = serviceOver({
        row: { connectServices: [], license: LICENSE_KEY },
      });

      await expect(
        service.setService({
          organizationId: ORGANIZATION,
          service: "instant_evals",
          enabled: true,
        }),
      ).resolves.toEqual({ enabledServices: ["instant_evals"] });
      expect(store.update).toHaveBeenCalledWith({
        where: { id: ORGANIZATION },
        data: { connectServices: ["instant_evals"] },
      });
      expect(isAuditLogExempt("connect.setService")).toBe(false);
    });
  });

  describe("when an admin switches a service off", () => {
    it("leaves every other service it had switched on", async () => {
      const { service } = serviceOver({
        row: {
          connectServices: ["instant_evals", "managed_models"],
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
        row: { connectServices: [], license: LICENSE_KEY },
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
        row: { connectServices: [], license: LICENSE_KEY },
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

describe("given a host that refuses the read", () => {
  describe("when an admin reads the Connect settings", () => {
    /** @scenario "An unregistered license surfaces as a named error" */
    it("carries the refusal back as data rather than failing the read", async () => {
      const { service } = serviceOver({
        row: { connectServices: ["instant_evals"], license: LICENSE_KEY },
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
