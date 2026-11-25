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
 * Role audiences follow the role a user holds on the project: an admin audience
 * is not a member, a members audience is not a viewer.
 * @see specs/data-privacy/content-visibility.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
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

const ADMIN_PERMISSIONS = new Set([
  "traces:view",
  "traces:update",
  "project:manage",
  "project:update",
]);
const MEMBER_PERMISSIONS = new Set(["traces:view", "traces:update", "project:update"]);
const VIEWER_PERMISSIONS = new Set(["traces:view"]);

const audiencePolicy = {
  ...PLATFORM_DEFAULT_DATA_PRIVACY,
  categories: {
    ...PLATFORM_DEFAULT_DATA_PRIVACY.categories,
    input: {
      disposition: "restrict" as const,
      audience: { ...EMPTY_AUDIENCE, admins: true },
    },
    output: {
      disposition: "restrict" as const,
      audience: { ...EMPTY_AUDIENCE, members: true },
    },
  },
};

function protectionsFor(held: ReadonlySet<string>) {
  return TraceViewerProtectionService.create({
    authz: createApiFixture<AuthzApi>({
      hasPermission: async ({ permission }) => held.has(permission),
    }),
    projects: createApiFixture<ProjectApi>({ findWithTeam: async () => project }),
    plans: createApiFixture<PlanProvider>({}),
    dataPrivacy: createApiFixture<DataPrivacyApi>({
      getResolvedForProjects: async () => audiencePolicy,
    }),
    fallbackVisibilityDays: 30,
    logger: createTestLogger().logger,
  }).resolve({ projectId: project.id, userId: "user-1", publiclyShared: false });
}

describe("given input restricted to admins and output restricted to the members role", () => {
  /** @scenario Content restricted to admins is visible to an admin */
  it("shows an admin the input and not the output", async () => {
    const protections = await protectionsFor(ADMIN_PERMISSIONS);

    expect(protections.canSeeCapturedInput).toBe(true);
    expect(protections.canSeeCapturedOutput).toBe(false);
  });

  /** @scenario Content restricted to admins is hidden from a plain member */
  it("shows a member the output and hides the input", async () => {
    const protections = await protectionsFor(MEMBER_PERMISSIONS);

    expect(protections.canSeeCapturedInput).toBe(false);
    expect(protections.canSeeCapturedOutput).toBe(true);
  });

  it("hides both from a viewer", async () => {
    const protections = await protectionsFor(VIEWER_PERMISSIONS);

    expect(protections.canSeeCapturedInput).toBe(false);
    expect(protections.canSeeCapturedOutput).toBe(false);
  });
});
