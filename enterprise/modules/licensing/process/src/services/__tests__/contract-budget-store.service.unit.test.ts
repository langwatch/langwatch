import type {
  CreateGatewayBudgetInput,
  GatewayApi,
  GatewayBudgetWithSeats,
  GatewayMoney,
} from "@langwatch/gateway-contract";
/**
 * @vitest-environment node
 * @see enterprise/modules/licensing/specs/licensing.feature
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
  const created: CreateGatewayBudgetInput[] = [];
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
    }),
  });
  return { store, created };
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

  describe("when the contract budget is created", () => {
    /** @scenario "The contract budget is the organization's live gateway budget named by the contract's id" */
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
});
