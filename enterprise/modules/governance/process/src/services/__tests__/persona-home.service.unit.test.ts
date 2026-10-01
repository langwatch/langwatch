// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { createApiFixture } from "@langwatch/api-fixture";
import type { AuthzService } from "@langwatch/authz-contract";
import type { EntitlementApi, Plan } from "@langwatch/entitlement-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import type { UserApi } from "@langwatch/user-contract";
import { describe, expect, it, vi } from "vitest";

import { PersonaHomeService } from "../persona-home.service.ts";

const freePlan: Plan = {
  planSource: "subscription",
  type: "FREE",
  name: "FREE",
  free: true,
  maxMembers: 10,
  maxMembersLite: 10,
  maxMessagesPerMonth: 1000,
  canPublish: true,
  prices: { USD: 0, EUR: 0 },
};

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
}: {
  memberSlugs?: string[];
  orgSlugs?: string[];
  manages?: boolean;
}) {
  const findSharedProjectSlugs = vi.fn(async ({ memberUserId }: { memberUserId?: string }) =>
    memberUserId === undefined ? orgSlugs : memberSlugs,
  );
  const permissions: Pick<AuthzService, "getDecision"> = {
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
      featureFlags: createApiFixture<FeatureFlagApi>({ isEnabled: async () => false }),
      organizations: createApiFixture<OrganizationApi>({ findPrimaryIntent: async () => null }),
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
