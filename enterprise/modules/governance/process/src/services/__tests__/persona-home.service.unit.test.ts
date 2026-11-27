import type { AuthzApi } from "@langwatch/authz-contract";
import type { EntitlementApi, Plan } from "@langwatch/entitlement-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { type OrganizationApi, OrganizationUserRole } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { nowInstant } from "@langwatch/time";
import type { UserApi } from "@langwatch/user-contract";
import { describe, expect, it, vi } from "vitest";

import { PersonaHomeService } from "../../features/personal/services/persona-home.service.ts";

const freePlan: Plan = {
  planSource: "subscription",
  type: "FREE",
  name: "FREE",
  free: true,
  maxMembers: 10,
  maxMembersLite: 10,
  maxMembersDeveloper: 0,
  maxMessagesPerMonth: 1000,
  canPublish: true,
  prices: { USD: 0, EUR: 0 },
};

/** One member as `findMemberById` reads it; only the role and the Billing-only flag matter here. */
function memberRow({ billingOnly }: { billingOnly: boolean }) {
  const now = nowInstant();
  return {
    userId: "user_1",
    organizationId: "org_1",
    role: billingOnly ? OrganizationUserRole.EXTERNAL : OrganizationUserRole.MEMBER,
    createdAt: now,
    updatedAt: now,
    departmentId: null,
    disabledAt: null,
    billingOnly,
    user: {
      id: "user_1",
      name: null,
      email: null,
      emailVerified: true,
      image: null,
      pendingSsoSetup: false,
      userHashKey: null,
      twoFactorEnabled: false,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: null,
      deactivatedAt: null,
      lastHomePath: null,
      tracesExplorerTourDismissedAt: null,
      passkeyNudgeDismissedAt: null,
      teamMemberships: [],
    },
  };
}

const quietSetup = {
  hasPersonalVKs: false,
  hasRoutingPolicies: false,
  hasIngestionSources: false,
  hasAnomalyRules: false,
  hasRecentActivity: false,
  hasApplicationTraces: false,
  governanceActive: false,
};

function service({
  memberSlugs = [],
  orgSlugs = [],
  manages = false,
  billingOnly = false,
  isSaas = true,
}: {
  memberSlugs?: string[];
  orgSlugs?: string[];
  manages?: boolean;
  billingOnly?: boolean;
  isSaas?: boolean;
}) {
  const findSharedProjectSlugs = vi.fn(async ({ memberUserId }: { memberUserId?: string }) =>
    memberUserId === undefined ? orgSlugs : memberSlugs,
  );
  const permissions: Pick<AuthzApi, "getDecision"> = {
    getDecision: async () => ({ permitted: manages, organizationRole: null }),
  };
  return {
    findSharedProjectSlugs,
    home: PersonaHomeService.create({
      setupState: { resolve: async () => quietSetup },
      projects: createApiFixture<ProjectApi>({ findSharedProjectSlugs }),
      entitlements: createApiFixture<EntitlementApi>({
        getActivePlan: async () => freePlan,
      }),
      permissions,
      users: createApiFixture<UserApi>({ findLastHomePath: async () => null }),
      featureFlags: createApiFixture<FeatureFlagApi>({ isEnabled: async () => true }),
      organizations: createApiFixture<OrganizationApi>({
        findPrimaryIntent: async () => null,
        findMemberById: async () => memberRow({ billingOnly }),
      }),
      isSaas,
    }),
  };
}

describe("PersonaHomeService", () => {
  it("routes a member to the oldest shared project they belong to", async () => {
    const { home, findSharedProjectSlugs } = service({ memberSlugs: ["acme"] });
    const resolved = await home.resolve({ organizationId: "org_1", userId: "user_1" });
    expect(resolved.firstProjectSlug).toBe("acme");
    expect(findSharedProjectSlugs).toHaveBeenCalledOnce();
  });

  it("falls back to the organization's oldest shared project for a manager", async () => {
    const { home } = service({ orgSlugs: ["platform"], manages: true });
    const resolved = await home.resolve({ organizationId: "org_1", userId: "user_1" });
    expect(resolved.firstProjectSlug).toBe("platform");
  });

  it("offers no project to a non-manager outside every shared team", async () => {
    const { home, findSharedProjectSlugs } = service({ orgSlugs: ["platform"] });
    const resolved = await home.resolve({ organizationId: "org_1", userId: "user_1" });
    expect(resolved.firstProjectSlug).toBeNull();
    expect(findSharedProjectSlugs).toHaveBeenCalledOnce();
  });
});

describe("PersonaHomeService for a Billing-only member (ADR-205)", () => {
  const args = { organizationId: "org_1", userId: "user_1" };

  /** @scenario "The home page sends someone who only pays to the plan page" */
  it("sends a Billing-only member to the plan page as an override", async () => {
    const saas = await service({ billingOnly: true }).home.resolve(args);
    const selfHosted = await service({ billingOnly: true, isSaas: false }).home.resolve(args);
    expect(saas).toMatchObject({ destination: "/settings/subscription", isOverride: true });
    expect(selfHosted.destination).toBe("/settings/license");
  });

  it("keeps the usual home for everyone who is not Billing only", async () => {
    expect((await service({ memberSlugs: ["acme"] }).home.resolve(args)).destination).toBe("/acme");
    expect((await service({ manages: true }).home.resolve(args)).destination).toBe(
      "/coding-agents",
    );
    expect((await service({}).home.resolve(args)).destination).toBe("/coding-agents");
  });
});
