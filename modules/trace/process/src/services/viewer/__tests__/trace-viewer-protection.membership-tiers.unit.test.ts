/**
 * Content-visibility membership is the permission engine's own answer: a role on the organization,
 * team or project counts, as it does for opening the trace. Runs the real engine over grants.
 * @see modules/trace/specs/trace-viewer-protection.feature
 */
import {
  type AuthzApi,
  AuthzEngine,
  type CollectedBinding,
  type CollectedGrants,
} from "@langwatch/authz-contract";
import {
  EMPTY_AUDIENCE,
  PLATFORM_DEFAULT_DATA_PRIVACY,
  type DataPrivacyApi,
  type ResolvedDataPrivacy,
} from "@langwatch/data-privacy-contract";
import type { PlanProvider } from "@langwatch/entitlement-contract";
import type { ProjectApi, ProjectWithTeam } from "@langwatch/project-contract";
import { createTestLogger } from "@langwatch/test-harness";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { TraceViewerProtectionService } from "../../trace-viewer-protection.service.ts";

const ORG = "organization-1";
const TEAM = "team-platform";
const PROJECT = "project-web-app";
const VIEWER_ID = "user-viewer";
const AT = new Date("2026-09-01T00:00:00Z");

const project: ProjectWithTeam = {
  id: PROJECT,
  name: "web-app",
  slug: "web-app",
  apiKey: "key",
  lwqlKey: "lwql",
  teamId: TEAM,
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
    id: TEAM,
    name: "platform",
    slug: "platform",
    organizationId: ORG,
    createdAt: AT,
    updatedAt: AT,
    archivedAt: null,
    isPersonal: false,
    ownerUserId: null,
    departmentId: null,
  },
};

const engine = new AuthzEngine();

type Holder = Readonly<{
  organizationRole: CollectedGrants["organizationRole"];
  bindings: CollectedBinding[];
}>;

/** An authz port whose answers are the real engine's decisions over `holder`'s grants. */
function engineBackedAuthz(holder: Holder): AuthzApi {
  const grants: CollectedGrants = {
    principal: { type: "user", id: VIEWER_ID },
    organizationId: ORG,
    organizationRole: holder.organizationRole,
    isOrgMember: holder.organizationRole !== null,
    membershipDisabled: false,
    bindings: holder.bindings,
    customRolePermissions: new Map(),
  };

  return createApiFixture<AuthzApi>({
    hasPermission: async ({ permission }) =>
      engine.decide({
        grants,
        permission,
        scope: { type: "project", id: PROJECT, teamId: TEAM, organizationId: ORG },
      }).allowed,
  });
}

const capturePolicy: ResolvedDataPrivacy = PLATFORM_DEFAULT_DATA_PRIVACY;

function inputRestrictedTo(audience: Partial<typeof EMPTY_AUDIENCE>): ResolvedDataPrivacy {
  return {
    ...PLATFORM_DEFAULT_DATA_PRIVACY,
    categories: {
      ...PLATFORM_DEFAULT_DATA_PRIVACY.categories,
      input: { disposition: "restrict", audience: { ...EMPTY_AUDIENCE, ...audience } },
    },
  };
}

function protectionsFor({ holder, policy }: { holder: Holder; policy: ResolvedDataPrivacy }) {
  return TraceViewerProtectionService.create({
    authz: engineBackedAuthz(holder),
    projects: createApiFixture<ProjectApi>({ findWithTeam: async () => project }),
    plans: createApiFixture<PlanProvider>({}),
    dataPrivacy: createApiFixture<DataPrivacyApi>({
      getResolvedForProjects: async () => policy,
    }),
    fallbackVisibilityDays: 30,
    logger: createTestLogger().logger,
  }).resolve({ projectId: PROJECT, userId: VIEWER_ID, publiclyShared: false });
}

const organizationAdmin: Holder = {
  organizationRole: "ADMIN",
  bindings: [{ roleKey: "admin", scopeType: "ORGANIZATION", scopeId: ORG }],
};

describe("given an organization admin with no role on the project's team", () => {
  describe("when no privacy rule restricts content", () => {
    /** @scenario "An organization admin with no team role sees captured content" */
    it("shows them the trace input", async () => {
      const protections = await protectionsFor({
        holder: organizationAdmin,
        policy: capturePolicy,
      });

      expect(protections.canSeeCapturedInput).toBe(true);
    });
  });

  describe("when a rule restricts trace input to admins", () => {
    /** @scenario "An organization admin with no team role is in the Admins audience" */
    it("shows them the trace input", async () => {
      const protections = await protectionsFor({
        holder: organizationAdmin,
        policy: inputRestrictedTo({ admins: true }),
      });

      expect(protections.canSeeCapturedInput).toBe(true);
    });
  });
});

describe("given a member role held on the project only", () => {
  describe("when no privacy rule restricts content", () => {
    /** @scenario "A project-level role counts as project membership" */
    it("shows them the trace input", async () => {
      const protections = await protectionsFor({
        holder: {
          organizationRole: "MEMBER",
          bindings: [{ roleKey: "member", scopeType: "PROJECT", scopeId: PROJECT }],
        },
        policy: capturePolicy,
      });

      expect(protections.canSeeCapturedInput).toBe(true);
    });
  });
});

describe("given an ordinary organization member holding a viewer role on the team", () => {
  describe("when a rule restricts trace input to the Members role group", () => {
    /** @scenario "Belonging to the organization does not put a viewer in the Members audience" */
    it("hides the trace input", async () => {
      const protections = await protectionsFor({
        holder: {
          organizationRole: "MEMBER",
          bindings: [
            { roleKey: "member", scopeType: "ORGANIZATION", scopeId: ORG },
            { roleKey: "viewer", scopeType: "TEAM", scopeId: TEAM },
          ],
        },
        policy: inputRestrictedTo({ members: true }),
      });

      expect(protections.canSeeCapturedInput).toBe(false);
    });
  });
});

describe("given an organization member the engine denies trace access on the project", () => {
  describe("when no privacy rule restricts content", () => {
    /** @scenario "Someone the permission engine denies trace access is not a member" */
    it("hides the trace input", async () => {
      const protections = await protectionsFor({
        holder: {
          organizationRole: "MEMBER",
          bindings: [{ roleKey: "member", scopeType: "ORGANIZATION", scopeId: ORG }],
        },
        policy: capturePolicy,
      });

      expect(protections.canSeeCapturedInput).toBe(false);
    });
  });
});
