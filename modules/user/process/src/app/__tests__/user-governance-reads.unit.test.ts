import { createApiFixture } from "@langwatch/api-fixture";
import {
  type CliBootstrapResult,
  type GovernanceBudgetOverviewForUser,
  type GovernanceRestApi,
  PLATFORM_TOOL_POLICY_DEFAULTS,
  type PersonalUsageRollup,
} from "@langwatch/enterprise-governance-contract";
import { describe, expect, it, vi } from "vitest";

import { createUserTestApp, createUserTestOrganizations } from "./user.fixture.ts";

const ROLLUP: PersonalUsageRollup = {
  summary: {
    spentUsd: 0,
    billedUsd: 0,
    requests: 0,
    promptTokens: 0,
    completionTokens: 0,
    mostUsedModel: null,
  },
  dailyBuckets: [],
  breakdownByModel: [],
};
const OVERVIEW: GovernanceBudgetOverviewForUser = { gatewayAccess: true, budgets: [] };
const BOOTSTRAP: CliBootstrapResult = {
  tools: [],
  providers: [],
  gatewayProviders: [],
  budget: { monthlyLimitUsd: null, monthlyUsedUsd: 0, period: "MONTHLY" },
  gatewayUrl: "https://gateway.example.com",
  adminEmail: null,
  toolPolicies: PLATFORM_TOOL_POLICY_DEFAULTS,
};

function appWhere({ member }: { member: boolean }) {
  const personalUsageDashboard = vi.fn(async () => ROLLUP);
  const personalBudgetOverview = vi.fn(async () => OVERVIEW);
  const cliBootstrap = vi.fn(async () => BOOTSTRAP);
  const organizations = Object.assign(createUserTestOrganizations(), {
    isMember: vi.fn(async () => member),
  });
  const governance = createApiFixture<GovernanceRestApi>({
    personalUsageDashboard,
    personalBudgetOverview,
    cliBootstrap,
  });
  const app = createUserTestApp({ dependencies: { governance, organizations } });

  return { app, personalUsageDashboard, personalBudgetOverview, cliBootstrap };
}

describe("UserApp governance reads", () => {
  describe("given a caller outside the organization", () => {
    /** @scenario "A caller outside the organization cannot read a personal usage rollup" */
    it("refuses the personal usage read before governance is asked", async () => {
      const { app, personalUsageDashboard } = appWhere({ member: false });

      await expect(
        app.getPersonalUsageRollup({ userId: "user-1", organizationId: "org-1" }),
      ).rejects.toMatchObject({ code: "user_not_in_organization" });
      expect(personalUsageDashboard).not.toHaveBeenCalled();
    });
  });

  describe("given a member of the organization", () => {
    /** @scenario "A member's personal usage reads their own rollup over the window they gave" */
    it("reads the member's own rollup over the given window", async () => {
      const { app, personalUsageDashboard } = appWhere({ member: true });

      const rollup = await app.getPersonalUsageRollup({
        userId: "user-1",
        organizationId: "org-1",
        windowStartMs: 1_000,
        windowEndMs: 2_000,
      });

      expect(rollup).toEqual(ROLLUP);
      expect(personalUsageDashboard).toHaveBeenCalledWith(
        { organizationId: "org-1", window: { startMs: 1_000, endMs: 2_000 } },
        { id: "user-1" },
      );
    });

    it("leaves the window to governance when only one end is given", async () => {
      const { app, personalUsageDashboard } = appWhere({ member: true });

      await app.getPersonalUsageRollup({
        userId: "user-1",
        organizationId: "org-1",
        windowStartMs: 1_000,
      });

      expect(personalUsageDashboard).toHaveBeenCalledWith(
        { organizationId: "org-1" },
        { id: "user-1" },
      );
    });

    /** @scenario "A member's budget overview lists their own budgets with top models when asked" */
    it("reads the member's own budget overview with top models", async () => {
      const { app, personalBudgetOverview } = appWhere({ member: true });

      await expect(
        app.getBudgetOverview({
          userId: "user-1",
          organizationId: "org-1",
          includeTopModels: true,
        }),
      ).resolves.toEqual(OVERVIEW);
      expect(personalBudgetOverview).toHaveBeenCalledWith(
        { organizationId: "org-1", includeTopModels: true },
        { id: "user-1" },
      );
    });

    /** @scenario "The CLI login ceremony reads the caller's own bootstrap" */
    it("resolves the member's own CLI bootstrap", async () => {
      const { app, cliBootstrap } = appWhere({ member: true });

      await expect(
        app.getCliBootstrap({ userId: "user-1", organizationId: "org-1" }),
      ).resolves.toEqual(BOOTSTRAP);
      expect(cliBootstrap).toHaveBeenCalledWith({ organizationId: "org-1" }, { id: "user-1" });
    });
  });
});
