import {
  cliBootstrapResultSchema,
  governanceBudgetOverviewForUserSchema,
  governanceTrpc,
  personalUsageRollupSchema,
  type CliBootstrapResult,
  type GovernanceBudgetOverviewForUser,
  type GovernanceRestApi,
  PLATFORM_TOOL_POLICY_DEFAULTS,
  type PersonalUsageRollup,
} from "@langwatch/enterprise-governance-contract";
// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * `governance.*` over the real tRPC runtime, pinned to main's wire
 * (platform/app/ee/governance/routers/governance.ts on origin/main).
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { governanceTrpcTransport } from "../governance.trpc.ts";
import {
  governanceTrpcMembers,
  governanceTrpcRuntime,
  procedureKinds,
} from "./support/governance-trpc.fixture.ts";

const workspace = {
  userId: "user_2",
  displayName: "Ada",
  teamId: "team_1",
  projectId: "project_1",
  projectSlug: "ada-personal",
};

const setupState = {
  hasPersonalVKs: false,
  hasRoutingPolicies: false,
  hasIngestionSources: true,
  hasAnomalyRules: false,
  hasRecentActivity: false,
  hasApplicationTraces: false,
  governanceActive: true,
};
const home = {
  persona: "project_only" as const,
  destination: "/acme",
  isOverride: false,
  governanceUiEnabled: false,
  intentPinned: false,
  firstProjectSlug: "acme",
};
const emptyPage = { events: [], nextCursor: null, nextCursorCompound: null };
const rollup: PersonalUsageRollup = {
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
const overview: GovernanceBudgetOverviewForUser = { gatewayAccess: true, budgets: [] };
const bootstrap: CliBootstrapResult = {
  tools: [],
  providers: [],
  gatewayProviders: [],
  budget: { monthlyLimitUsd: null, monthlyUsedUsd: 0, period: "MONTHLY" },
  gatewayUrl: "https://gateway.example.com",
  adminEmail: null,
  toolPolicies: PLATFORM_TOOL_POLICY_DEFAULTS,
};

function mount(answer: typeof workspace | null) {
  const asked: string[] = [];
  const calls: unknown[] = [];
  const app = createApiFixture<GovernanceRestApi>({
    findActorWorkspace: async () => answer,
    governanceResolveHome: async (input, by) => {
      calls.push([input, by]);
      return home;
    },
    governanceSetupState: async (input) => {
      calls.push(input);
      return setupState;
    },
    governanceOcsfExport: async (input, by) => {
      calls.push([input, by]);
      return emptyPage;
    },
    governanceRecordWorkspaceView: async (input) => {
      calls.push(input);
      return { recorded: true, auditLogId: "audit_1" };
    },
    personalUsageDashboard: async (input, by) => {
      calls.push([input, by]);
      return rollup;
    },
    personalBudgetOverview: async (input, by) => {
      calls.push([input, by]);
      return overview;
    },
    cliBootstrap: async (input, by) => {
      calls.push([input, by]);
      return bootstrap;
    },
    governanceQuarantineFillStats: async (input) => {
      calls.push(input);
      return {
        windowSeconds: 60,
        threshold: 100,
        spanCount: 0,
        rate: 0,
        exceeded: false,
        perSource: [],
      };
    },
  });
  const router = governanceTrpcRuntime(governanceTrpcMembers({ permits: () => true, asked })).mount(
    governanceTrpcTransport,
    () => app,
  );

  return { router, asked, calls, caller: router.createCaller({ actor: { id: "user_1" } }) };
}

describe("the governance tRPC namespace", () => {
  it("serves main's procedures as queries", () => {
    expect(procedureKinds(mount(null).router._def.procedures)).toEqual({
      resolveActorPersonalProject: "query",
      resolveHome: "query",
      setupState: "query",
      ocsfExport: "query",
      quarantineFillStats: "query",
      recordWorkspaceView: "mutation",
      personalUsage: "query",
      budgetOverview: "query",
      cliBootstrap: "query",
    });
  });

  it("resolves the caller's home under organization:view", async () => {
    const { caller, asked, calls } = mount(null);
    await expect(caller.resolveHome({ organizationId: "org_1" })).resolves.toEqual(home);
    expect(asked).toEqual(["organization:view"]);
    expect(calls).toEqual([[{ organizationId: "org_1" }, { id: "user_1" }]]);
  });

  /** @scenario setupState returns boolean OR for nav-promotion signal */
  it("answers the setup state under governance:view", async () => {
    const { caller, asked, calls } = mount(null);

    await expect(caller.setupState({ organizationId: "org_1" })).resolves.toEqual(setupState);
    expect(asked).toEqual(["governance:view"]);
    expect(calls).toEqual([{ organizationId: "org_1" }]);
  });

  it("pages the OCSF export under complianceExport:view from main's defaults", async () => {
    const { caller, asked, calls } = mount(null);

    await expect(caller.ocsfExport({ organizationId: "org_1" })).resolves.toEqual(emptyPage);
    expect(asked).toEqual(["complianceExport:view"]);
    expect(calls).toMatchObject([
      [{ organizationId: "org_1", sinceMs: 0, limit: 500 }, { id: "user_1" }],
    ]);
  });

  it("evaluates quarantine fill with main's default window and threshold", async () => {
    const { caller, calls } = mount(null);

    await caller.quarantineFillStats({ organizationId: "org_1" });
    expect(calls).toEqual([{ organizationId: "org_1", windowSeconds: 60, threshold: 100 }]);
  });

  it("answers the actor's personal workspace under governance:view", async () => {
    const { caller, asked } = mount(workspace);

    await expect(
      caller.resolveActorPersonalProject({ organizationId: "org_1", actor: "ada@example.com" }),
    ).resolves.toEqual(workspace);
    expect(asked).toEqual(["governance:view"]);
  });

  it("answers null when the actor resolves to nobody here, as main did", async () => {
    const { caller } = mount(null);

    await expect(
      caller.resolveActorPersonalProject({ organizationId: "org_1", actor: "nobody" }),
    ).resolves.toBeNull();
  });

  it("records the admin's workspace view as the caller under governance:view", async () => {
    const { caller, asked, calls } = mount(null);

    await expect(
      caller.recordWorkspaceView({ organizationId: "org_1", targetTeamId: "team_2", kind: "team" }),
    ).resolves.toEqual({ recorded: true, auditLogId: "audit_1" });
    expect(asked).toEqual(["governance:view"]);
    expect(calls).toEqual([
      { organizationId: "org_1", targetTeamId: "team_2", kind: "team", actorUserId: "user_1" },
    ]);
  });

  describe("given the caller's own /me reads, moved from user.* with main's permission", () => {
    it("keeps the moved /me reads' wire shapes", () => {
      const { personalUsage, budgetOverview, cliBootstrap } = governanceTrpc.members;

      expect([personalUsage?.kind, budgetOverview?.kind, cliBootstrap?.kind]).toEqual([
        "query",
        "query",
        "query",
      ]);
      expect(personalUsage?.output).toBe(personalUsageRollupSchema);
      expect(budgetOverview?.output).toBe(governanceBudgetOverviewForUserSchema);
      expect(cliBootstrap?.output).toBe(cliBootstrapResultSchema);
      expect(
        personalUsage?.input.validate({
          organizationId: "org-1",
          windowStartMs: 1,
          windowEndMs: 2,
        }),
      ).toBe(true);
      expect(
        budgetOverview?.input.validate({ organizationId: "org-1", includeTopModels: true }),
      ).toBe(true);
      expect(cliBootstrap?.input.validate({ organizationId: "org-1" })).toBe(true);
    });

    /** @scenario "A member's personal usage reads their own rollup over the window they gave" */
    it("reads the caller's own rollup over the given window under organization:view", async () => {
      const { caller, asked, calls } = mount(null);

      await expect(
        caller.personalUsage({ organizationId: "org_1", windowStartMs: 1, windowEndMs: 2 }),
      ).resolves.toEqual(rollup);
      expect(asked).toEqual(["organization:view"]);
      expect(calls).toEqual([
        [{ organizationId: "org_1", window: { startMs: 1, endMs: 2 } }, { id: "user_1" }],
      ]);
    });

    it("leaves the window to governance when only one end is given", async () => {
      const { caller, calls } = mount(null);

      await caller.personalUsage({ organizationId: "org_1", windowStartMs: 1 });
      expect(calls).toEqual([[{ organizationId: "org_1" }, { id: "user_1" }]]);
    });

    /** @scenario "A member's budget overview lists their own budgets with top models when asked" */
    it("reads the caller's own budget overview with top models under organization:view", async () => {
      const { caller, asked, calls } = mount(null);

      await expect(
        caller.budgetOverview({ organizationId: "org_1", includeTopModels: true }),
      ).resolves.toEqual(overview);
      expect(asked).toEqual(["organization:view"]);
      expect(calls).toEqual([
        [{ organizationId: "org_1", includeTopModels: true }, { id: "user_1" }],
      ]);
    });

    /** @scenario "The CLI login ceremony reads the caller's own bootstrap" */
    it("resolves the caller's own CLI bootstrap under organization:view", async () => {
      const { caller, asked, calls } = mount(null);

      await expect(caller.cliBootstrap({ organizationId: "org_1" })).resolves.toEqual(bootstrap);
      expect(asked).toEqual(["organization:view"]);
      expect(calls).toEqual([[{ organizationId: "org_1" }, { id: "user_1" }]]);
    });
  });
});
