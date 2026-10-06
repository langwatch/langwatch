/**
 * @vitest-environment node
 * `GatewayModule.budgetOverviewForUser`: delegates to `BudgetOverviewService`
 * and proves it stays scoped to the caller's own organization.
 */
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { type OrganizationApi, TeamNotFoundError } from "@langwatch/organization-contract";
import { ResourceScope } from "@langwatch/process";
import type { ProjectApi } from "@langwatch/project-contract";
import { ScopedSecrets } from "@langwatch/secrets";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryGatewayRepositories } from "../../repositories/memory/memory.gateway.repositories.ts";
import { GatewayModule } from "../gateway.app.ts";

/** No handle is ever resolved through it in these tests. */
const noSecrets = new ScopedSecrets(async (_handle, build) => build(undefined));

/** A peer that answers nothing: the composition resolves it, no test call reaches it. */
function peer(name: string): never {
  return new Proxy(
    {},
    {
      get(_target, property) {
        if (typeof property === "symbol") return undefined;
        throw new Error(`The ${name} peer was called for "${String(property)}".`);
      },
    },
  ) as never;
}

const ORG_ID = "org_1";
const OTHER_ORG_ID = "org_2";
const USER_ID = "user_1";

const isMember = vi.fn();
const getPersonalWorkspace = vi.fn();
const isEnabled = vi.fn();
const listGroupsForMember = vi.fn();

function organizationsStub(overrides: Partial<OrganizationApi>): OrganizationApi {
  return overrides as OrganizationApi;
}

function featureFlagsStub(overrides: Partial<FeatureFlagApi>): FeatureFlagApi {
  return overrides as FeatureFlagApi;
}

function projectsStub(overrides: Partial<ProjectApi>): ProjectApi {
  return overrides as ProjectApi;
}

/** The gateway over memory twins, with the two reads the overview makes watched. */
async function gatewayAppStub() {
  const repositories = MemoryGatewayRepositories.create();
  const virtualKeyReads = vi.spyOn(repositories.virtualKeys, "findAllInOrganization");
  const budgetReads = vi.spyOn(repositories.budgets, "resolveApplicableBudgets");
  const app = await GatewayModule.create({
    dependencies: {
      authz: peer("authz"),
      projects: projectsStub({}),
      evaluators: peer("evaluators"),
      evaluations: peer("evaluations"),
      monitors: peer("monitors"),
      organizations: organizationsStub({ isMember, getPersonalWorkspace, listGroupsForMember }),
      featureFlags: featureFlagsStub({ isEnabled }),
      modelProviders: peer("modelProviders"),
      traces: peer("traces"),
      oneTimeReveals: peer("oneTimeReveals"),
      apiKeys: peer("apiKeys"),
    },
    repositories,
    config: {
      spendSettlementGraceMs: void 0,
      internalUrl: void 0,
      controlPlaneUrl: void 0,
      publicBaseUrl: void 0,
      baseUrl: undefined,
      publicUrl: undefined,
      isSaas: false,
      allowLoopbackVoiceProviders: false,
    },
    resources: new ResourceScope(),
    secrets: noSecrets,
  });
  return { app, virtualKeyReads, budgetReads };
}

describe("GatewayModule.budgetOverviewForUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPersonalWorkspace.mockRejectedValue(new TeamNotFoundError());
    isEnabled.mockResolvedValue(true);
    listGroupsForMember.mockResolvedValue([]);
  });

  describe("given a caller who is not a member of the organization", () => {
    /** @scenario A per-member overview refuses a caller outside the organization */
    it("reports no gateway access and never reads the organization's keys or budgets", async () => {
      isMember.mockResolvedValue(false);
      const { app, virtualKeyReads, budgetReads } = await gatewayAppStub();

      const overview = await app.budgetOverviewForUser({
        organizationId: OTHER_ORG_ID,
        userId: USER_ID,
      });

      expect(overview).toEqual({ gatewayAccess: false, reason: "no_membership", budgets: [] });
      expect(isMember).toHaveBeenCalledWith({ organizationId: OTHER_ORG_ID, userId: USER_ID });
      expect(virtualKeyReads).not.toHaveBeenCalled();
      expect(budgetReads).not.toHaveBeenCalled();
    });
  });

  describe("given a member of the organization with no personal workspace or budgets", () => {
    /** @scenario A member's overview reads only their own organization's budgets */
    it("answers with access, and scopes the underlying budget read to that organization", async () => {
      isMember.mockResolvedValue(true);
      const { app, budgetReads } = await gatewayAppStub();

      const overview = await app.budgetOverviewForUser({
        organizationId: ORG_ID,
        userId: USER_ID,
      });

      expect(overview).toEqual({ gatewayAccess: true, budgets: [] });
      expect(isMember).toHaveBeenCalledWith({ organizationId: ORG_ID, userId: USER_ID });
      expect(budgetReads).toHaveBeenCalledWith(expect.objectContaining({ organizationId: ORG_ID }));
    });
  });
});
