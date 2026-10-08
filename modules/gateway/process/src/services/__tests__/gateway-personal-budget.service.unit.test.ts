/**
 * @vitest-environment node
 * The /me budget banner, answered from the gateway's own check on the caller's own key.
 * @see modules/gateway/specs/gateway-personal-budget.feature
 */
import type { GatewayApi, GatewayBudgetCheckResult } from "@langwatch/gateway-contract";
import {
  type OrganizationApi,
  type PersonalWorkspace,
  TeamNotFoundError,
} from "@langwatch/organization-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import { memoryVirtualKeySeed } from "../../__tests__/support/gateway-memory-seeds.fixture.ts";
import { MemoryGatewayRepositories } from "../../repositories/memory/memory.gateway.repositories.ts";
import { MemoryGatewayStore } from "../../repositories/memory/memory.gateway.store.ts";
import { GatewayPersonalBudgetService } from "../gateway-personal-budget.service.ts";

const workspace: PersonalWorkspace = {
  team: { id: "team-1", name: "Ada's workspace", slug: "ada", createdAtMs: 0 },
  project: { id: "project-1", name: "Ada", slug: "ada", apiKey: "sk-lw-1", createdAtMs: 0 },
};

const softWarning: GatewayBudgetCheckResult = {
  decision: "soft_warn",
  warnings: [],
  blockReason: null,
  blockedBy: [],
  scopes: [
    { scope: "PRINCIPAL", scopeId: "user-1", window: "MONTH", spentUsd: "85", limitUsd: "100" },
  ],
};

async function serviceFor({
  withKey = true,
  personalWorkspace = async () => workspace,
  publicBaseUrl,
}: {
  withKey?: boolean;
  personalWorkspace?: OrganizationApi["getPersonalWorkspace"];
  publicBaseUrl?: string;
} = {}) {
  const { repositories } = new MemoryGatewayRepositories(MemoryGatewayStore.create());
  if (withKey) {
    await repositories.virtualKeys.create({
      ...memoryVirtualKeySeed({ id: "vk-1", name: "Ada's key", organizationId: "org-1" }),
      principalUserId: "user-1",
    });
  }
  const checkBudget = vi.fn(async () => softWarning);
  const service = GatewayPersonalBudgetService.create({
    personalKeys: repositories.virtualKeys,
    budgetDecisions: createApiFixture<GatewayApi>({ checkBudget }),
    organizations: createApiFixture<OrganizationApi>({
      getPersonalWorkspace: personalWorkspace,
      findSupportContact: async () => "it@example.com",
    }),
    publicBaseUrl,
  });

  return { service, checkBudget };
}

describe("GatewayPersonalBudgetService", () => {
  describe("given a member whose personal key is at a soft warning", () => {
    /** @scenario "The personal budget warns at the gateway's soft warning on the caller's own key" */
    it("checks that key at no projected cost and answers a warning with the figures", async () => {
      const { service, checkBudget } = await serviceFor();

      const budget = await service.getPersonalBudget({ userId: "user-1", organizationId: "org-1" });

      expect(budget).toEqual({
        status: "warning",
        scope: "principal",
        spentUsd: "85",
        limitUsd: "100",
        period: "month",
        adminEmail: "it@example.com",
      });
      expect(checkBudget).toHaveBeenCalledWith({
        organizationId: "org-1",
        teamId: "team-1",
        projectId: "project-1",
        virtualKeyId: "vk-1",
        principalUserId: "user-1",
        projectedCostUsd: 0,
      });
    });

    it("links the request-increase page under the deployment's public base URL", async () => {
      const { service } = await serviceFor({ publicBaseUrl: "https://app.example.com/" });

      const budget = await service.getPersonalBudget({ userId: "user-1", organizationId: "org-1" });

      expect(budget).toMatchObject({
        requestIncreaseUrl:
          "https://app.example.com/me/budget/request?scope=principal&scope_id=user-1&limit_usd=100&spent_usd=85",
      });
    });
  });

  describe("given a member who holds no personal key", () => {
    /** @scenario "A member without a personal key is checked on the principal scope" */
    it("checks a sentinel key that matches no key-scoped budget", async () => {
      const { service, checkBudget } = await serviceFor({ withKey: false });

      await service.getPersonalBudget({ userId: "user-1", organizationId: "org-1" });

      expect(checkBudget).toHaveBeenCalledWith(
        expect.objectContaining({ virtualKeyId: "_ingestion_:user:user-1" }),
      );
    });
  });

  describe("given a member with no personal workspace in the organization", () => {
    /** @scenario "A member without a personal workspace has no budget to describe" */
    it("answers the bare ok without asking the gateway", async () => {
      const { service, checkBudget } = await serviceFor({
        personalWorkspace: async () => {
          throw new TeamNotFoundError();
        },
      });

      const budget = await service.getPersonalBudget({ userId: "user-1", organizationId: "org-1" });

      expect(budget).toEqual({ status: "ok" });
      expect(checkBudget).not.toHaveBeenCalled();
    });
  });
});
