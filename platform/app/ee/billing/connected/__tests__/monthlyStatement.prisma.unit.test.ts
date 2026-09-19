/**
 * The database, ledger and budget bindings of the monthly statement.
 *
 * Boundaries mocked: Prisma, the spend events reader and the budget service.
 *
 * @see specs/self-hosting/connected-services/connected-billing.feature
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "~/generated/prisma/client";
import { PrismaMonthlyStatementStore } from "../monthlyStatement.prisma";

const AUGUST = new Date("2026-08-01T00:00:00.000Z");
const SEPTEMBER = new Date("2026-09-01T00:00:00.000Z");

const { mockSumCostNanoUsdByRequestType, mockListWithHealth, mockSpendEvents } =
  vi.hoisted(() => {
    const mockSumCostNanoUsdByRequestType = vi.fn();
    const mockListWithHealth = vi.fn();
    return {
      mockSumCostNanoUsdByRequestType,
      mockListWithHealth,
      mockSpendEvents: {
        value: { sumCostNanoUsdByRequestType: mockSumCostNanoUsdByRequestType },
      },
    };
  });

vi.mock("~/server/app-layer/app", () => ({
  getApp: () => ({
    gateway: { spendEvents: mockSpendEvents.value, budgets: {} },
  }),
}));

vi.mock("~/server/gateway/budget.service", () => ({
  GatewayBudgetService: {
    create: () => ({ listWithHealth: mockListWithHealth }),
  },
}));

function makeStore(overrides: Record<string, unknown> = {}) {
  const prisma = {
    organization: { findMany: vi.fn(async () => []) },
    connectedBillingAccount: { findUnique: vi.fn(async () => null) },
    project: { findMany: vi.fn(async () => [{ id: "project-1" }]) },
    issuedLicense: { findMany: vi.fn(async () => []) },
    connectedStatement: {
      findUnique: vi.fn(async () => null),
      upsert: vi.fn(async () => undefined),
    },
    ...overrides,
  };
  return {
    store: new PrismaMonthlyStatementStore(prisma as unknown as PrismaClient),
    prisma,
  };
}

describe("PrismaMonthlyStatementStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSpendEvents.value = {
      sumCostNanoUsdByRequestType: mockSumCostNanoUsdByRequestType,
    };
  });

  describe("listAccounts", () => {
    it("lists only the self-hosted customers that were onboarded", async () => {
      const { store } = makeStore({
        organization: {
          findMany: vi.fn(async () => [
            { id: "org-acme", name: "ACME" },
            { id: "org-other", name: "Other" },
          ]),
        },
        connectedBillingAccount: {
          findUnique: vi.fn(
            async ({ where }: { where: { organizationId: string } }) =>
              where.organizationId === "org-acme"
                ? {
                    id: "cba-1",
                    billingEmail: "billing@acme.example",
                    commitUsdCents: 100_000,
                  }
                : null,
          ),
        },
      });

      expect(await store.listAccounts()).toEqual([
        {
          id: "cba-1",
          organizationId: "org-acme",
          organizationName: "ACME",
          billingEmail: "billing@acme.example",
          commitUsdCents: 100_000,
        },
      ]);
    });
  });

  describe("spendByService", () => {
    /** @scenario "The billing contact receives a monthly usage statement" */
    it("sums the month across every project of the customer, in cents", async () => {
      // 42 USD as nano-USD.
      mockSumCostNanoUsdByRequestType.mockResolvedValue(42_000_000_000);
      const { store } = makeStore();

      const lines = await store.spendByService({
        organizationId: "org-acme",
        month: AUGUST,
      });

      expect(lines).toEqual([{ service: "instant_evals", usdCents: 4_200 }]);
      expect(mockSumCostNanoUsdByRequestType).toHaveBeenCalledWith({
        tenantIds: ["project-1"],
        requestType: "instant_eval",
        fromMs: AUGUST.getTime(),
        toMs: SEPTEMBER.getTime(),
      });
    });

    it("reports nothing rather than zero when the ledger is not available", async () => {
      mockSpendEvents.value = undefined;
      const { store } = makeStore();

      expect(
        await store.spendByService({
          organizationId: "org-acme",
          month: AUGUST,
        }),
      ).toEqual([]);
    });
  });

  describe("readDrawnDownUsdCents", () => {
    it("reads the contract budget's spend in cents", async () => {
      mockListWithHealth.mockResolvedValue({
        spendAvailable: true,
        budgets: [
          {
            externalId: "connect-contract",
            spentUsd: { toNumber: () => 125.5 },
          },
        ],
      });
      const { store } = makeStore();

      expect(await store.readDrawnDownUsdCents("org-acme")).toBe(12_550);
    });

    /** @scenario "The billing contact receives a monthly usage statement" */
    it("answers unavailable rather than zero when the ledger cannot be read", async () => {
      mockListWithHealth.mockResolvedValue({
        spendAvailable: false,
        budgets: [],
      });
      const { store } = makeStore();

      expect(await store.readDrawnDownUsdCents("org-acme")).toBeNull();
    });

    it("answers unavailable when the customer has no contract budget", async () => {
      mockListWithHealth.mockResolvedValue({
        spendAvailable: true,
        budgets: [
          { externalId: "something-else", spentUsd: { toNumber: () => 1 } },
        ],
      });
      const { store } = makeStore();

      expect(await store.readDrawnDownUsdCents("org-acme")).toBeNull();
    });
  });

  describe("readSeats", () => {
    it("reads the licensed and reported seats of the active license", async () => {
      const { store } = makeStore({
        issuedLicense: {
          findMany: vi.fn(async () => [
            {
              maxMembers: 50,
              reportedMembers: 53,
              expiresAt: new Date("2027-01-01T00:00:00.000Z"),
              revokedAt: null,
              supersededAt: null,
            },
          ]),
        },
      });

      expect(await store.readSeats("org-acme")).toEqual({
        licensed: 50,
        reported: 53,
      });
    });

    it("reports the seats as not known when the install never synced", async () => {
      const { store } = makeStore({
        issuedLicense: {
          findMany: vi.fn(async () => [
            {
              maxMembers: 50,
              reportedMembers: null,
              expiresAt: new Date("2027-01-01T00:00:00.000Z"),
              revokedAt: null,
              supersededAt: null,
            },
          ]),
        },
      });

      expect(await store.readSeats("org-acme")).toEqual({
        licensed: 50,
        reported: null,
      });
    });
  });

  describe("hasSent and recordSent", () => {
    /** @scenario "The statement is sent once per month" */
    it("addresses the month by the pair that makes it unique", async () => {
      const { store, prisma } = makeStore({
        connectedStatement: {
          findUnique: vi.fn(async () => ({ id: "cs-1" })),
          upsert: vi.fn(async () => undefined),
        },
      });

      expect(await store.hasSent({ accountId: "cba-1", month: AUGUST })).toBe(
        true,
      );
      expect(prisma.connectedStatement.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { accountId_month: { accountId: "cba-1", month: AUGUST } },
        }),
      );

      await store.recordSent({
        accountId: "cba-1",
        month: AUGUST,
        sentAt: SEPTEMBER,
      });
      expect(prisma.connectedStatement.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: { accountId: "cba-1", month: AUGUST, sentAt: SEPTEMBER },
          update: {},
        }),
      );
    });
  });
});
