import { createApiFixture } from "@langwatch/api-fixture";
/**
 * @vitest-environment node
 * `GatewayApp.budgetOverviewForUser`: delegates to `BudgetOverviewService`
 * and proves it stays scoped to the caller's own organization.
 */
import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { ResourceScope } from "@langwatch/kernel";
import { type OrganizationApi, TeamNotFoundError } from "@langwatch/organization-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { Encryption } from "@langwatch/process-stores";
import type { ProjectApi } from "@langwatch/project-contract";
import { ScopedSecrets } from "@langwatch/secrets";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GatewayApp } from "../gateway.app.ts";

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
const virtualKeyFindMany = vi.fn();
const groupMembershipFindMany = vi.fn();
const gatewayBudgetFindMany = vi.fn();

function organizationsStub(overrides: Partial<OrganizationApi>): OrganizationApi {
  return overrides as OrganizationApi;
}

function featureFlagsStub(overrides: Partial<FeatureFlagApi>): FeatureFlagApi {
  return overrides as FeatureFlagApi;
}

function projectsStub(overrides: Partial<ProjectApi>): ProjectApi {
  return overrides as ProjectApi;
}

/** Unreached whenever no budget resolves — the only path these tests take. */
function fakeClickHouse(overrides: Partial<ClickHouseQueryClient>): ClickHouseQueryClient {
  return overrides as ClickHouseQueryClient;
}

/** Answers the reads the budget-resolution repository makes, one delegate at a time. */
function fakePrisma(overrides: {
  virtualKey?: Partial<PrismaClient["virtualKey"]>;
  groupMembership?: Partial<PrismaClient["groupMembership"]>;
  gatewayBudget?: Partial<PrismaClient["gatewayBudget"]>;
}): PrismaClient {
  return overrides as PrismaClient;
}

/** The slice of the application this surface reaches, and nothing else. */
async function gatewayAppStub(): Promise<GatewayApp> {
  return GatewayApp.create({
    dependencies: {
      webhooks: peer("webhooks"),
      entitlement: peer("entitlement"),
      authz: peer("authz"),
      projects: projectsStub({}),
      evaluators: peer("evaluators"),
      monitors: peer("monitors"),
      organizations: organizationsStub({ isMember, getPersonalWorkspace }),
      featureFlags: featureFlagsStub({ isEnabled }),
      modelProviders: peer("modelProviders"),
      traces: peer("traces"),
      oneTimeReveals: peer("oneTimeReveals"),
    },
    members: {
      prisma: fakePrisma({
        virtualKey: { findMany: virtualKeyFindMany },
        groupMembership: { findMany: groupMembershipFindMany },
        gatewayBudget: { findMany: gatewayBudgetFindMany },
      }),
      clickhouse: fakeClickHouse({ query: vi.fn(), insert: vi.fn() }),
      gatewayInternalProtocol: {},
      encryption: createApiFixture<Encryption>(),
    },
    config: {
      spendSettlementGraceMs: void 0,
      internalUrl: void 0,
      controlPlaneUrl: void 0,
      baseUrl: undefined,
      publicUrl: undefined,
      isSaas: false,
    },
    resources: new ResourceScope(),
    secrets: noSecrets,
  });
}

describe("GatewayApp.budgetOverviewForUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPersonalWorkspace.mockRejectedValue(new TeamNotFoundError());
    isEnabled.mockResolvedValue(true);
    virtualKeyFindMany.mockResolvedValue([]);
    groupMembershipFindMany.mockResolvedValue([]);
    gatewayBudgetFindMany.mockResolvedValue([]);
  });

  describe("given a caller who is not a member of the organization", () => {
    /** @scenario A per-member overview refuses a caller outside the organization */
    it("reports no gateway access and never reads the organization's keys or budgets", async () => {
      isMember.mockResolvedValue(false);
      const app = await gatewayAppStub();

      const overview = await app.budgetOverviewForUser({
        organizationId: OTHER_ORG_ID,
        userId: USER_ID,
      });

      expect(overview).toEqual({ gatewayAccess: false, reason: "no_membership", budgets: [] });
      expect(isMember).toHaveBeenCalledWith({ organizationId: OTHER_ORG_ID, userId: USER_ID });
      expect(virtualKeyFindMany).not.toHaveBeenCalled();
      expect(gatewayBudgetFindMany).not.toHaveBeenCalled();
    });
  });

  describe("given a member of the organization with no personal workspace or budgets", () => {
    /** @scenario A member's overview reads only their own organization's budgets */
    it("answers with access, and scopes the underlying budget read to that organization", async () => {
      isMember.mockResolvedValue(true);
      const app = await gatewayAppStub();

      const overview = await app.budgetOverviewForUser({
        organizationId: ORG_ID,
        userId: USER_ID,
      });

      expect(overview).toEqual({ gatewayAccess: true, budgets: [] });
      expect(isMember).toHaveBeenCalledWith({ organizationId: ORG_ID, userId: USER_ID });
      expect(gatewayBudgetFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ organizationId: ORG_ID }),
        }),
      );
    });
  });
});
