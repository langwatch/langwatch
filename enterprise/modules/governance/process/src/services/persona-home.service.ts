// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { AuthzService } from "@langwatch/authz-contract";
import {
  PersonaHomeResolverService,
  type PersonaResolution,
} from "@langwatch/enterprise-governance-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import type { UserApi } from "@langwatch/user-contract";

import type { DefaultGovernanceSetupStateService } from "./governance-setup-state.service.ts";

type PersonaHomePeers = {
  setupState: Pick<DefaultGovernanceSetupStateService, "resolve">;
  projects: Pick<ProjectApi, "findSharedProjectSlugs">;
  entitlements: Pick<EntitlementApi, "getActivePlan">;
  permissions: Pick<AuthzService, "getDecision">;
  users: Pick<UserApi, "findLastHomePath">;
  featureFlags: Pick<FeatureFlagApi, "isEnabled">;
  organizations: Pick<OrganizationApi, "findPrimaryIntent">;
};

/** Main's `governance.resolveHome`: every signal gathered, then the pure persona policy. */
export class PersonaHomeService {
  private constructor(
    private readonly peers: PersonaHomePeers,
    private readonly resolver: PersonaHomeResolverService,
  ) {}

  static create(peers: PersonaHomePeers): PersonaHomeService {
    return new PersonaHomeService(peers, PersonaHomeResolverService.create());
  }

  async resolve({
    organizationId,
    userId,
  }: {
    organizationId: string;
    userId: string;
  }): Promise<PersonaResolution> {
    const { setupState, projects, entitlements, permissions, users, featureFlags, organizations } =
      this.peers;
    const [state, memberSlugs, plan, manage, lastHomePath, hasGovernanceUi, intent] =
      await Promise.all([
        setupState.resolve(organizationId),
        projects.findSharedProjectSlugs({ organizationId, memberUserId: userId, limit: 1 }),
        entitlements.getActivePlan({ organizationId, operator: { id: userId } }).catch(() => null),
        permissions.getDecision({
          userId,
          permission: "organization:manage",
          scope: { tier: "organization", id: organizationId },
        }),
        users.findLastHomePath({ id: userId }),
        featureFlags
          .isEnabled("release_ui_ai_governance_enabled", {
            kind: "organization",
            organizationId,
            userId,
          })
          .catch(() => false),
        organizations.findPrimaryIntent(organizationId).catch(() => null),
      ]);
    const [firstProjectSlug = null] =
      memberSlugs.length === 0 && manage.permitted
        ? await projects.findSharedProjectSlugs({ organizationId, limit: 1 }).catch(() => [])
        : memberSlugs;

    return this.resolver.resolveSafe({
      organizationIntent: intent,
      userLastHomePath: lastHomePath,
      setupState: {
        hasPersonalVKs: state.hasPersonalVKs,
        hasIngestionSources: state.hasIngestionSources,
        hasRecentActivity: state.hasRecentActivity,
      },
      hasApplicationTraces: state.hasApplicationTraces,
      hasOrganizationManagePermission: manage.permitted,
      isEnterprise: plan?.type === "ENTERPRISE",
      hasGovernanceUi,
      firstProjectSlug,
    });
  }
}
