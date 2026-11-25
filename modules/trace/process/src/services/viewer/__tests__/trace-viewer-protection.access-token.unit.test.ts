/**
 * A project-bound access token (the hosted MCP's OAuth sign-in) is its person capped at one
 * project; an API key is not a person. @see modules/trace/specs/trace-viewer-protection.feature
 */
import { type Authorization, sealAuthorization } from "@langwatch/authorization";
import type { AuthzApi } from "@langwatch/authz-contract";
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
import { describe, expect, it, vi } from "vitest";

import { TraceViewerProtectionService } from "../../trace-viewer-protection.service.ts";

const AT = new Date("2026-11-25T00:00:00Z");
const SHARED_PROJECT = "project-shared";

const project: ProjectWithTeam = {
  id: "project-1",
  name: "Support agent",
  slug: "support-agent",
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
    name: "Support",
    slug: "support",
    organizationId: "organization-1",
    createdAt: AT,
    updatedAt: AT,
    archivedAt: null,
    isPersonal: false,
    ownerUserId: null,
    departmentId: null,
  },
};

const ADMIN = new Set([
  "cost:view",
  "traces:view",
  "traces:update",
  "project:manage",
  "project:update",
]);
const MEMBER = new Set(["traces:view", "traces:update", "project:update"]);
const adminsOnly = {
  disposition: "restrict" as const,
  audience: { ...EMPTY_AUDIENCE, admins: true },
};

const everyCategoryForAdmins: ResolvedDataPrivacy = {
  ...PLATFORM_DEFAULT_DATA_PRIVACY,
  categories: { input: adminsOnly, output: adminsOnly, system: adminsOnly, tools: adminsOnly },
};

function protectionsWith({ held }: { held: ReadonlySet<string> }) {
  const getResolvedForProjects = vi.fn(async () => everyCategoryForAdmins);
  const service = TraceViewerProtectionService.create({
    authz: createApiFixture<AuthzApi>({
      hasPermission: async ({ permission }) => held.has(permission),
      can: async ({ permission }) => held.has(permission),
    }),
    projects: createApiFixture<ProjectApi>({
      findWithTeam: async () => project,
      findIdentity: async () => ({
        id: project.id,
        name: project.name,
        slug: project.slug,
        teamId: project.teamId,
        organizationId: project.team.organizationId,
        isPersonal: false,
        ownerUserId: null,
        kind: "application",
      }),
    }),
    plans: createApiFixture<PlanProvider>({}),
    dataPrivacy: createApiFixture<DataPrivacyApi>({ getResolvedForProjects }),
    fallbackVisibilityDays: 30,
    logger: createTestLogger().logger,
  });
  return { service, getResolvedForProjects };
}

function proofSharing({ userId }: { userId: string }): Authorization {
  return sealAuthorization({
    actor: { type: "user", id: userId },
    principal: { type: "user", id: userId },
    scope: { organizationId: "organization-1" },
    grants: [
      { projectId: project.id, permissions: ["traces:view"], via: [], kind: "own" },
      {
        projectId: SHARED_PROJECT,
        permissions: ["traces:view"],
        via: ["grant_0"],
        kind: "shared",
        condition: { type: "trace", from: 0, until: null },
      },
    ],
    expiresAt: Date.now() + 60_000,
    purpose: { kind: "route", route: "test" },
  });
}

describe("TraceViewerProtectionService.resolveForApiKey", () => {
  describe("given trace content restricted to Admins in every category", () => {
    /** @scenario "A project-bound access token reads restricted trace content as its person" */
    it("shows an admin's access token all four, as the app shows that admin", async () => {
      const { service } = protectionsWith({ held: ADMIN });

      const protections = await service.resolveForApiKey({
        projectId: project.id,
        principal: { type: "user", id: "admin-1" },
      });

      expect(protections.canSeeCapturedInput).toBe(true);
      expect(protections.canSeeCapturedOutput).toBe(true);
      expect(protections.contentCategories?.system.canSee).toBe(true);
      expect(protections.contentCategories?.tools.canSee).toBe(true);
      expect(protections.canSeeCosts).toBe(true);
    });

    /** @scenario "A project-bound access token never reads more than its person" */
    it("hides the input from a plain member's access token, as the app hides it from them", async () => {
      const { service } = protectionsWith({ held: MEMBER });

      const protections = await service.resolveForApiKey({
        projectId: project.id,
        principal: { type: "user", id: "member-1" },
      });

      expect(protections.canSeeCapturedInput).toBe(false);
      expect(protections.capturedInputVisibleTo).toBe("Admins");
    });

    it("reads as the public when asked outside the token's own project", async () => {
      const { service } = protectionsWith({ held: ADMIN });

      const protections = await service.resolveForApiKey({
        projectId: project.id,
        principal: { type: "user", id: "admin-1" },
        readsAsPerson: false,
      });

      expect(protections.canSeeCapturedInput).toBe(false);
      expect(protections.contentCategories?.system.canSee).toBe(false);
    });

    /** @scenario "An API key keeps reading restricted trace content as the public" */
    it("hides the input from an API key, whatever its grants", async () => {
      const { service } = protectionsWith({ held: ADMIN });

      const protections = await service.resolveForApiKey({
        projectId: project.id,
        principal: { type: "apiKey", id: "key-1" },
      });

      expect(protections.canSeeCapturedInput).toBe(false);
      expect(protections.contentCategories?.tools.canSee).toBe(false);
    });
  });

  describe("given an access token reading through a proof that shares another project", () => {
    /** @scenario "A project-bound access token's read folds in the policies its proof reads" */
    it("reads the policy across its own project and the shared one", async () => {
      const { service, getResolvedForProjects } = protectionsWith({ held: ADMIN });

      await service.resolveForApiKey({
        projectId: project.id,
        principal: { type: "user", id: "admin-1" },
        authorization: proofSharing({ userId: "admin-1" }),
      });

      expect(getResolvedForProjects).toHaveBeenCalledWith({
        projectIds: [project.id, SHARED_PROJECT],
      });
    });

    it("ignores a proof minted for someone else, reading only its own project's policy", async () => {
      const { service, getResolvedForProjects } = protectionsWith({ held: ADMIN });

      await service.resolveForApiKey({
        projectId: project.id,
        principal: { type: "user", id: "admin-1" },
        authorization: proofSharing({ userId: "someone-else" }),
      });

      expect(getResolvedForProjects).toHaveBeenCalledWith({ projectIds: [project.id] });
    });
  });
});
