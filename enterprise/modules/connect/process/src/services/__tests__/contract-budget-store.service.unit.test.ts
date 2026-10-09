import type { GatewayApi, GatewayBudgetWithSeats, GatewayMoney } from "@langwatch/gateway-contract";
/**
 * @vitest-environment node
 * @see enterprise/modules/connect/specs/connect.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import {
  CONTRACT_BUDGET_EXTERNAL_ID,
  ContractBudgetStoreService,
} from "../contract-budget-store.service.ts";

const AT = Temporal.Instant.from("2026-09-29T00:00:00Z");

function money(value: string): GatewayMoney {
  return { toString: () => value, toFixed: (digits) => Number(value).toFixed(digits) };
}

function budget(overrides: Partial<GatewayBudgetWithSeats>): GatewayBudgetWithSeats {
  return {
    id: "budget-1",
    organizationId: "org-1",
    scopeType: "ORGANIZATION",
    scopeId: "org-1",
    providerKey: null,
    name: "Hosted services contract",
    description: null,
    window: "MANUAL",
    limitUsd: money("1250.50"),
    onBreach: "BLOCK",
    timezone: null,
    externalId: CONTRACT_BUDGET_EXTERNAL_ID,
    metadata: { connect_cap_set_by: "customer" },
    spentUsd: money("0"),
    currentPeriodStartedAt: AT,
    resetsAt: AT,
    lastResetAt: null,
    cycleAnchorAt: null,
    archivedAt: null,
    createdAt: AT,
    updatedAt: AT,
    createdById: "system:connect-license",
    managedByVirtualKeyId: null,
    ...overrides,
  };
}

function storeOver(budgets: GatewayBudgetWithSeats[]) {
  const updated: Parameters<GatewayApi["updateBudget"]>[0][] = [];
  const created: Parameters<GatewayApi["createBudget"]>[0][] = [];
  const resets: Parameters<GatewayApi["resetBudget"]>[0][] = [];
  const store = ContractBudgetStoreService.create({
    gateway: createApiFixture<GatewayApi>({
      listBudgetsWithHealth: async () => ({
        budgets,
        spendAvailable: true,
        readAt: AT,
        scopeReach: new Map(),
      }),
      createBudget: async (input) => {
        created.push(input);
        return budget({});
      },
      updateBudget: async (input) => {
        updated.push(input);
        return budget({});
      },
      resetBudget: async (input) => {
        resets.push(input);
        return budget({});
      },
    }),
  });
  return { store, updated, created, resets };
}

describe("the contract budget kept in the gateway's budget table", () => {
  describe("given a live budget carrying the contract's external id", () => {
    /** @scenario "The contract budget is the organization's live gateway budget named by the contract's id" */
    it("answers it in cents, with the cap the customer set", async () => {
      const { store } = storeOver([budget({ id: "other", externalId: null }), budget({})]);

      await expect(store.findForOrganization("org-1")).resolves.toEqual({
        id: "budget-1",
        limitUsdCents: 125050,
        capSetByCustomer: true,
        lastResetAt: null,
      });
    });
  });

  describe("given only an archived contract budget", () => {
    /** @scenario "An archived contract budget is no contract budget" */
    it("answers none", async () => {
      const { store } = storeOver([budget({ archivedAt: AT })]);

      await expect(store.findForOrganization("org-1")).resolves.toBeNull();
    });
  });

  describe("when the customer sets its own cap", () => {
    /** @scenario "A customer lowers its own cap" */
    it("writes the cap in dollars and marks it as the customer's", async () => {
      const { store, updated } = storeOver([budget({})]);

      await store.setLimit({
        organizationId: "org-1",
        id: "budget-1",
        limitUsdCents: 25050,
        capSetByCustomer: true,
        actorId: "system:connect-license",
      });

      expect(updated).toEqual([
        {
          id: "budget-1",
          organizationId: "org-1",
          limitUsd: "250.50",
          metadata: { connect_cap_set_by: "customer" },
          actorUserId: "system:connect-license",
        },
      ]);
    });
  });

  describe("when the contract budget is created", () => {
    /** @scenario "A new contract budget is a blocking organization budget under the contract's id" */
    it("writes a blocking organization budget under the contract's id, capped by LangWatch", async () => {
      const { store, created } = storeOver([]);

      await store.create({ organizationId: "org-1", limitUsdCents: 50000, operatorId: "op-1" });

      expect(created).toMatchObject([
        {
          organizationId: "org-1",
          scope: { kind: "ORGANIZATION", organizationId: "org-1" },
          window: "MANUAL",
          limitUsd: "500.00",
          onBreach: "BLOCK",
          externalId: CONTRACT_BUDGET_EXTERNAL_ID,
          metadata: { connect_cap_set_by: "langwatch" },
          allowUnreachable: true,
          actorUserId: "op-1",
        },
      ]);
    });
  });

  describe("when a new window starts", () => {
    it("resets that budget through the gateway, acting as the operator", async () => {
      const { store, resets } = storeOver([budget({})]);

      await store.reset({ organizationId: "org-1", id: "budget-1", actorId: "operator-1" });

      expect(resets).toEqual([
        { id: "budget-1", organizationId: "org-1", actorUserId: "operator-1" },
      ]);
    });
  });
});
