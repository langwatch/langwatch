/**
 * ADR-208: a rule's audience may name API keys; a named key reads restricted content as Admins do,
 * every other key as the public. @see modules/trace/specs/trace-viewer-protection.feature
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
const adminsAndOneKey = {
  disposition: "restrict" as const,
  audience: { ...EMPTY_AUDIENCE, admins: true, apiKeyIds: ["key-named"] },
};

const everyCategoryForAdmins: ResolvedDataPrivacy = {
  ...PLATFORM_DEFAULT_DATA_PRIVACY,
  categories: {
    input: adminsAndOneKey,
    output: adminsAndOneKey,
    system: adminsAndOneKey,
    tools: adminsAndOneKey,
  },
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

describe("TraceViewerProtectionService.resolveForApiKey", () => {
  describe("given every content category restricted to Admins and one named key", () => {
    /** @scenario "An API key the rule's audience names reads restricted trace content" */
    it("shows the named key all four, as Admins see them", async () => {
      const { service } = protectionsWith({ held: ADMIN });

      const protections = await service.resolveForApiKey({
        projectId: project.id,
        principal: { type: "apiKey", id: "key-named" },
      });

      expect(protections.canSeeCapturedInput).toBe(true);
      expect(protections.canSeeCapturedOutput).toBe(true);
      expect(protections.contentCategories?.system.canSee).toBe(true);
      expect(protections.contentCategories?.tools.canSee).toBe(true);
    });

    /** @scenario "An API key the rule's audience names reads restricted trace content" */
    it("still hides all four from any other key", async () => {
      const { service } = protectionsWith({ held: ADMIN });

      const protections = await service.resolveForApiKey({
        projectId: project.id,
        principal: { type: "apiKey", id: "key-other" },
      });

      expect(protections.canSeeCapturedInput).toBe(false);
      expect(protections.canSeeCapturedOutput).toBe(false);
      expect(protections.contentCategories?.system.canSee).toBe(false);
      expect(protections.contentCategories?.tools.canSee).toBe(false);
    });
  });

  describe("given a key reading through a proof that shares another project", () => {
    const SHARED_PROJECT = "project-shared";
    function proofFor(keyId: string): Authorization {
      return sealAuthorization({
        actor: { type: "api_key", id: keyId },
        principal: { type: "apiKey", id: keyId },
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

    /** @scenario Rules that disagree keep only the keys every rule names */
    it("folds the shared project's policy in, so its rule must name the key too", async () => {
      const { service, getResolvedForProjects } = protectionsWith({ held: ADMIN });

      await service.resolveForApiKey({
        projectId: project.id,
        principal: { type: "apiKey", id: "key-named" },
        authorization: proofFor("key-named"),
      });

      expect(getResolvedForProjects).toHaveBeenCalledWith({
        projectIds: [project.id, SHARED_PROJECT],
      });
    });

    it("ignores a proof minted for another key", async () => {
      const { service, getResolvedForProjects } = protectionsWith({ held: ADMIN });

      await service.resolveForApiKey({
        projectId: project.id,
        principal: { type: "apiKey", id: "key-named" },
        authorization: proofFor("key-other"),
      });

      expect(getResolvedForProjects).toHaveBeenCalledWith({ projectIds: [project.id] });
    });
  });
});
