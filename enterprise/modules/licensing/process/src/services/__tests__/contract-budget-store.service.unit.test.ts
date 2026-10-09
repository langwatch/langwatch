import type { GatewayApi, GatewayBudgetWithSeats, GatewayMoney } from "@langwatch/gateway-contract";
/**
 * @vitest-environment node
 * The contract budget's creation and cap are connect's; licensing only reads it and starts a
 * window.
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
  const resets: Parameters<GatewayApi["resetBudget"]>[0][] = [];
  const store = ContractBudgetStoreService.create({
    gateway: createApiFixture<GatewayApi>({
      listBudgetsWithHealth: async () => ({
        budgets,
        spendAvailable: true,
        readAt: AT,
        scopeReach: new Map(),
      }),
      resetBudget: async (input) => {
        resets.push(input);
        return budget({});
      },
    }),
  });
  return { store, resets };
}

describe("the contract budget kept in the gateway's budget table", () => {
  describe("given a live budget carrying the contract's external id", () => {
    it("answers it in cents, with the cap the customer set", async () => {
      const { store } = storeOver([budget({ id: "other", externalId: null }), budget({})]);

      await expect(store.findForOrganization("org-1")).resolves.toEqual({
        id: "budget-1",
        limitUsdCents: 125050,
        capSetByCustomer: true,
      });
    });
  });

  describe("given only an archived contract budget", () => {
    it("answers none", async () => {
      const { store } = storeOver([budget({ archivedAt: AT })]);

      await expect(store.findForOrganization("org-1")).resolves.toBeNull();
    });
  });

  describe("when a new window is started", () => {
    it("asks the gateway to reset the budget under the actor", async () => {
      const { store, resets } = storeOver([budget({})]);

      await store.reset({ organizationId: "org-1", id: "budget-1", actorId: "op-1" });

      expect(resets).toEqual([{ id: "budget-1", organizationId: "org-1", actorUserId: "op-1" }]);
    });
  });
});
