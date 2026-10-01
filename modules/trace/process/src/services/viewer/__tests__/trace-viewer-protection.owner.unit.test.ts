/**
 * Content restricted to the project owner opens for the owner, and only for
 * them, whatever role they hold on the project.
 * @see specs/data-privacy/content-visibility.feature
 */
import { createApiFixture } from "@langwatch/api-fixture";
import type { AuthzApi } from "@langwatch/authz-contract";
import {
  EMPTY_AUDIENCE,
  PLATFORM_DEFAULT_DATA_PRIVACY,
  type DataPrivacyApi,
} from "@langwatch/data-privacy-contract";
import type { PlanProvider } from "@langwatch/entitlement-contract";
import type { ProjectApi, ProjectWithTeam } from "@langwatch/project-contract";
import { createTestLogger } from "@langwatch/test-harness";
import { describe, expect, it } from "vitest";

import { TraceViewerProtectionService } from "../../trace-viewer-protection.service.ts";

const OWNER = "user-owner";
const AT = new Date("2026-09-01T00:00:00Z");

const project: ProjectWithTeam = {
  id: "project-1",
  name: "Personal",
  slug: "personal",
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
  isPersonal: true,
  ownerUserId: OWNER,
  personalFeatures: null,
  departmentId: null,
  langyEgressAllowlist: null,
  lastCodingAgentSessionAt: null,
  lastCodingAgentPullRequestAt: null,
  team: {
    id: "team-1",
    name: "Personal",
    slug: "personal",
    organizationId: "organization-1",
    createdAt: AT,
    updatedAt: AT,
    archivedAt: null,
    isPersonal: true,
    ownerUserId: OWNER,
    departmentId: null,
  },
};

/** Input restricted to the project owner; everything else captured for members. */
const ownerOnlyInput = {
  ...PLATFORM_DEFAULT_DATA_PRIVACY,
  categories: {
    ...PLATFORM_DEFAULT_DATA_PRIVACY.categories,
    input: {
      disposition: "restrict" as const,
      audience: { ...EMPTY_AUDIENCE, projectOwner: true },
    },
  },
};

function protectionsFor(userId: string) {
  return TraceViewerProtectionService.create({
    authz: createApiFixture<AuthzApi>({
      hasPermission: async ({ permission }) => permission === "traces:view",
    }),
    projects: createApiFixture<ProjectApi>({ findWithTeam: async () => project }),
    plans: createApiFixture<PlanProvider>({}),
    dataPrivacy: createApiFixture<DataPrivacyApi>({
      getResolvedForProject: async () => ownerOnlyInput,
    }),
    fallbackVisibilityDays: 30,
    processName: "test",
    logger: createTestLogger().logger,
  }).resolve({ projectId: project.id, userId, publiclyShared: false });
}

describe("given input restricted to the project owner", () => {
  describe("when the owner views a trace", () => {
    it("shows the owner the input", async () => {
      const protections = await protectionsFor(OWNER);

      expect(protections.canSeeCapturedInput).toBe(true);
      expect(protections.canSeeCapturedOutput).toBe(true);
    });
  });

  describe("when another member of the project views it", () => {
    it("hides the input and keeps the output", async () => {
      const protections = await protectionsFor("user-other");

      expect(protections.canSeeCapturedInput).toBe(false);
      expect(protections.canSeeCapturedOutput).toBe(true);
    });
  });
});
