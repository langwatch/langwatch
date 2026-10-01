import type { AuthzApi } from "@langwatch/authz-contract";
import {
  EMPTY_AUDIENCE,
  PLATFORM_DEFAULT_DATA_PRIVACY,
  type DataPrivacyApi,
} from "@langwatch/data-privacy-contract";
import type { PlanProvider } from "@langwatch/entitlement-contract";
import type { ProjectApi, ProjectWithTeam } from "@langwatch/project-contract";
import { createTestLogger } from "@langwatch/test-harness";
/**
 * Content restricted to a group opens for that group's members only, and a
 * group read that fails keeps it closed.
 * @see modules/trace/specs/trace-viewer-protection.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { TraceViewerProtectionService } from "../../trace-viewer-protection.service.ts";

const AT = new Date("2026-09-01T00:00:00Z");

const project: ProjectWithTeam = {
  id: "project-1",
  name: "Web app",
  slug: "web-app",
  apiKey: "key",
  lwqlKey: "lwql",
  teamId: "team-1",
  language: "python",
  framework: "other",
  kind: "application",
  firstMessage: true,
  integrated: true,
  createdAt: AT,
  updatedAt: AT,
  userLinkTemplate: null,
  traceSharingEnabled: false,
  presenceEnabled: false,
  s3Endpoint: null,
  s3AccessKeyId: null,
  s3SecretAccessKey: null,
  s3Bucket: null,
  archivedAt: null,
  isPersonal: false,
  ownerUserId: null,
  personalFeatures: null,
  departmentId: null,
  langyEgressAllowlist: null,
  lastCodingAgentSessionAt: null,
  lastCodingAgentPullRequestAt: null,
  team: {
    id: "team-1",
    name: "Platform",
    slug: "platform",
    organizationId: "organization-1",
    createdAt: AT,
    updatedAt: AT,
    archivedAt: null,
    isPersonal: false,
    ownerUserId: null,
    departmentId: null,
  },
};

const securityOnlyInput = {
  ...PLATFORM_DEFAULT_DATA_PRIVACY,
  categories: {
    ...PLATFORM_DEFAULT_DATA_PRIVACY.categories,
    input: {
      disposition: "restrict" as const,
      audience: { ...EMPTY_AUDIENCE, groupIds: ["group-security"] },
    },
  },
};

function protectionsFor({
  getAccessBreakdown,
}: {
  getAccessBreakdown: AuthzApi["getAccessBreakdown"];
}) {
  return TraceViewerProtectionService.create({
    authz: createApiFixture<AuthzApi>({
      hasPermission: async ({ permission }) => permission === "traces:view",
      getAccessBreakdown,
    }),
    projects: createApiFixture<ProjectApi>({ findWithTeam: async () => project }),
    plans: createApiFixture<PlanProvider>({}),
    dataPrivacy: createApiFixture<DataPrivacyApi>({
      getResolvedForProject: async () => securityOnlyInput,
    }),
    fallbackVisibilityDays: 30,
    processName: "test",
    logger: createTestLogger().logger,
  }).resolve({ projectId: project.id, userId: "user-1", publiclyShared: false });
}

function memberOf(groupIds: string[]): AuthzApi["getAccessBreakdown"] {
  return async ({ userId }) => ({
    user: { id: userId, name: null, email: null, orgRole: "MEMBER", orgRolePermissions: [] },
    groups: groupIds.map((id) => ({ id, name: id, slug: id, scimSource: null, bindings: [] })),
    directBindings: [],
  });
}

describe("given trace input restricted to the security group", () => {
  describe("when a member of that group views a trace", () => {
    /** @scenario "Trace content restricted to a group is visible to a member of that group" */
    it("shows them the input", async () => {
      const protections = await protectionsFor({
        getAccessBreakdown: memberOf(["group-security"]),
      });

      expect(protections.canSeeCapturedInput).toBe(true);
      expect(protections.canSeeCapturedOutput).toBe(true);
    });
  });

  describe("when a member of no such group views it", () => {
    /** @scenario "Trace content restricted to a group is hidden from a member outside it" */
    it("hides the input and keeps the output", async () => {
      const protections = await protectionsFor({ getAccessBreakdown: memberOf(["group-other"]) });

      expect(protections.canSeeCapturedInput).toBe(false);
      expect(protections.canSeeCapturedOutput).toBe(true);
    });
  });

  describe("when the group membership read fails", () => {
    /** @scenario "A failed group membership read hides group-restricted trace content" */
    it("hides the input", async () => {
      const protections = await protectionsFor({
        getAccessBreakdown: () => Promise.reject(new Error("groups unreadable")),
      });

      expect(protections.canSeeCapturedInput).toBe(false);
    });
  });
});
