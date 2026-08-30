/**
 * @vitest-environment node
 * @integration
 *
 * The v1 organization-key door on the pull-request usage rollup:
 * `GET /api/v1/coding-agent/pull-request-usage`. A user-bound organization API
 * key answers with the caller's organization-wide rollup and names no project
 * anywhere in the request; an organization service key (no user) and a legacy
 * project key are each refused with their own stable code; a key from another
 * organization learns nothing about a pull request mapped elsewhere.
 *
 * Every refusal is asserted on its code rather than its sentence. The code is
 * the contract a CLI or an agent branches on; the sentence beside it is copy
 * and will change.
 *
 * @see specs/coding-agent/pull-request-linkage.feature
 */
import { generate } from "@langwatch/ksuid";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type Organization,
  OrganizationUserRole,
  RoleBindingScopeType,
  type Team,
  TeamUserRole,
} from "~/generated/prisma/client";
import { ApiKeyService } from "~/server/api-key/api-key.service";
import { globalForApp, resetApp } from "~/server/app-layer/app";
import { CodingAgentSessionService } from "~/server/app-layer/coding-agent/coding-agent-session.service";
import { CodingAgentSessionsListService } from "~/server/app-layer/coding-agent/coding-agent-sessions-list.service";
import { PullRequestUsageService } from "~/server/app-layer/coding-agent/pull-request-usage.service";
import { NullCodingAgentSessionRepository } from "~/server/app-layer/coding-agent/repositories/coding-agent-session.repository";
import { NullCodingAgentSessionEventsRepository } from "~/server/app-layer/coding-agent/repositories/coding-agent-session-events.repository";
import { NullCodingAgentTraceSessionRepository } from "~/server/app-layer/coding-agent/repositories/coding-agent-trace-session.repository";
import { NullSessionMetricSeriesRepository } from "~/server/app-layer/coding-agent/repositories/session-metric-series.repository";
import { GithubInstallationsService } from "~/server/app-layer/github/github-installations.service";
import { GithubAppTokenService } from "~/server/app-layer/github/githubAppToken";
import { NullGithubInstallationsRepository } from "~/server/app-layer/github/repositories/github-installations.repository";
import { PrismaGithubPullRequestsRepository } from "~/server/app-layer/github/repositories/github-pull-requests.prisma.repository";
import { createTestApp } from "~/server/app-layer/presets";
import { NullGithubPullRequestLookup } from "~/server/app-layer/traces/session-groups.pull-request-link";
import { prisma } from "~/server/db";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { KSUID_RESOURCES } from "~/utils/constants";
import publishedSpec from "../../openapiLangWatch.json";
import { app } from "../[[...route]]/app.v1";

const ns = nanoid(8);
const USAGE_SPEC_PATH = "/api/v1/coding-agent/pull-request-usage";
const USAGE_PATH = `${USAGE_SPEC_PATH}?repository=acme/widgets&pullRequest=1`;

let organization: Organization;
let team: Team;
let callerUserId: string;
/** A user-bound key for the caller, carrying an org-wide admin binding. */
let callerToken: string;
/** An organization service key created for no user. */
let serviceToken: string;
/** A legacy project API key, which carries neither organization nor user. */
let legacyProjectKey: string;
/** Another organization entirely, whose key must learn nothing here. */
let otherOrganization: Organization;
let otherOrgToken: string;
let otherOrgUserId: string;

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

/** One organization with a user-bound admin key, mirroring real onboarding. */
async function seedCallerOrganization(): Promise<void> {
  organization = await prisma.organization.create({
    data: { name: `pr-usage-v1-${ns}`, slug: `--test-org-v1-${ns}` },
  });
  team = await prisma.team.create({
    data: {
      name: `pr-usage-v1-${ns}`,
      slug: `--test-team-v1-${ns}`,
      organizationId: organization.id,
    },
  });

  const caller = await prisma.user.create({
    data: { name: "Caller", email: `caller-v1-${ns}@example.com` },
  });
  callerUserId = caller.id;
  await prisma.organizationUser.create({
    data: {
      userId: callerUserId,
      organizationId: organization.id,
      role: OrganizationUserRole.ADMIN,
    },
  });
  await prisma.roleBinding.create({
    data: {
      id: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
      organizationId: organization.id,
      userId: callerUserId,
      role: TeamUserRole.ADMIN,
      scopeType: RoleBindingScopeType.ORGANIZATION,
      scopeId: organization.id,
    },
  });

  legacyProjectKey = `sk-lw-${nanoid(48)}`;
  await prisma.project.create({
    data: {
      id: `project_${nanoid()}`,
      name: "Caller Workspace",
      slug: `--test-caller-v1-${ns}`,
      language: "typescript",
      framework: "other",
      apiKey: legacyProjectKey,
      teamId: team.id,
      isPersonal: true,
      ownerUserId: callerUserId,
    },
  });

  const orgAdminBinding = {
    role: TeamUserRole.ADMIN,
    scopeType: RoleBindingScopeType.ORGANIZATION,
    scopeId: organization.id,
  };
  callerToken = (
    await ApiKeyService.create(prisma).create({
      name: `pr-usage-v1-caller-${ns}`,
      userId: callerUserId,
      createdByUserId: callerUserId,
      organizationId: organization.id,
      permissionMode: "all",
      bindings: [orgAdminBinding],
    })
  ).token;
  serviceToken = (
    await ApiKeyService.create(prisma).create({
      name: `pr-usage-v1-service-${ns}`,
      userId: null,
      createdByUserId: null,
      organizationId: organization.id,
      permissionMode: "all",
      bindings: [orgAdminBinding],
    })
  ).token;

  await prisma.githubPullRequest.create({
    data: {
      organizationId: organization.id,
      repositoryHost: "github.com",
      repositoryFullName: "acme/widgets",
      headBranch: "feat/linkage",
      prNumber: 1,
      htmlUrl: "https://github.com/acme/widgets/pull/1",
      title: "Link sessions to pull requests",
      state: "open",
      isDraft: false,
      authorLogin: "acme-dev",
      prCreatedAt: new Date("2026-07-01T09:00:00Z"),
    },
  });
}

/** A second organization whose user-bound key must see nothing of the first. */
async function seedOtherOrganization(): Promise<void> {
  otherOrganization = await prisma.organization.create({
    data: { name: `pr-usage-v1-other-${ns}`, slug: `--test-other-org-${ns}` },
  });
  const otherUser = await prisma.user.create({
    data: { name: "Elsewhere", email: `elsewhere-v1-${ns}@example.com` },
  });
  otherOrgUserId = otherUser.id;
  await prisma.organizationUser.create({
    data: {
      userId: otherUser.id,
      organizationId: otherOrganization.id,
      role: OrganizationUserRole.ADMIN,
    },
  });
  // The key-creation ceiling compares against role bindings, so the admin
  // grant has to exist as one before an admin-bound key can be minted.
  await prisma.roleBinding.create({
    data: {
      id: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
      organizationId: otherOrganization.id,
      userId: otherUser.id,
      role: TeamUserRole.ADMIN,
      scopeType: RoleBindingScopeType.ORGANIZATION,
      scopeId: otherOrganization.id,
    },
  });
  otherOrgToken = (
    await ApiKeyService.create(prisma).create({
      name: `pr-usage-v1-other-${ns}`,
      userId: otherUser.id,
      createdByUserId: otherUser.id,
      organizationId: otherOrganization.id,
      permissionMode: "all",
      bindings: [
        {
          role: TeamUserRole.ADMIN,
          scopeType: RoleBindingScopeType.ORGANIZATION,
          scopeId: otherOrganization.id,
        },
      ],
    })
  ).token;
}

beforeAll(async () => {
  await seedCallerOrganization();
  await seedOtherOrganization();

  // The route reads through the App. The pull-request mapping is real (the
  // Prisma repository above the row seeded per organization); sessions stay
  // null, which is what makes the answered rollup empty and its audit record
  // say zero projects contributed.
  const nullSessions = new NullCodingAgentSessionRepository();
  const nullSessionEvents = new NullCodingAgentSessionEventsRepository();
  const sessions = new CodingAgentSessionService({
    sessions: nullSessions,
    traceSessions: new NullCodingAgentTraceSessionRepository(),
    metricSeries: new NullSessionMetricSeriesRepository(),
    sessionEvents: nullSessionEvents,
  });
  globalForApp.__langwatch_app = createTestApp({
    codingAgents: {
      sessions,
      // The REST surface under test never reads it; the App's shape does.
      sessionsList: new CodingAgentSessionsListService({
        sessions,
        pullRequests: new NullGithubPullRequestLookup(),
        resolveOrganizationId: async () => organization.id,
      }),
      pullRequestUsage: new PullRequestUsageService({
        pullRequests: new PrismaGithubPullRequestsRepository(prisma),
        sessions: nullSessions,
        personalSessions: sessions,
        sessionEvents: nullSessionEvents,
        installations: new GithubInstallationsService(
          new NullGithubInstallationsRepository(),
          new GithubAppTokenService("", "", null),
        ),
        resolveOrganizationId: async () => organization.id,
        isSourceNonBillable: async () => false,
      }),
    },
  });
});

afterAll(async () => {
  await resetApp();
  await cleanupTestRows(prisma, [
    ["auditLog", { organizationId: organization.id }],
    ["githubPullRequest", { organizationId: organization.id }],
    ["roleBinding", { organizationId: organization.id }],
    ["roleBinding", { organizationId: otherOrganization.id }],
    ["apiKey", { organizationId: organization.id }],
    ["apiKey", { organizationId: otherOrganization.id }],
    ["project", { teamId: team.id }],
    ["organizationUser", { organizationId: organization.id }],
    ["organizationUser", { organizationId: otherOrganization.id }],
    ["user", { id: { in: [callerUserId, otherOrgUserId] } }],
    ["team", { id: team.id }],
    ["organization", { id: organization.id }],
    ["organization", { id: otherOrganization.id }],
  ]);
});

describe("Feature: Pull request usage v1 REST API", () => {
  describe("given a user-bound organization API key", () => {
    describe("when the usage is read with no project id anywhere", () => {
      /** @scenario "An organization key reads pull request usage without naming a project" */
      it("answers the caller's organization-wide rollup and records the read", async () => {
        const res = await app.request(USAGE_PATH, {
          headers: bearer(callerToken),
        });

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.pullRequest.repositoryFullName).toBe("acme/widgets");
        expect(Array.isArray(body.rows)).toBe(true);
        expect(body.totals).toMatchObject({ sessionsCount: 0 });

        const recorded = await prisma.auditLog.findFirst({
          where: {
            organizationId: organization.id,
            action: "codingAgents.pullRequestUsage",
          },
        });
        expect(recorded?.userId).toBe(callerUserId);
        expect(recorded?.targetKind).toBe("pullRequest");
        expect(recorded?.targetId).toBe("github.com/acme/widgets#1");
        expect(recorded?.args).toMatchObject({
          repository: "acme/widgets",
          pullRequest: 1,
          contributingProjectCount: 0,
        });
      });
    });
  });

  describe("given an organization service key created for no user", () => {
    describe("when the usage is read", () => {
      /** @scenario "An organization key with no bound user cannot read pull request usage" */
      it("refuses with the user-bound key required code", async () => {
        const res = await app.request(USAGE_PATH, {
          headers: bearer(serviceToken),
        });

        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.code).toBe("user_bound_key_required");
      });
    });
  });

  describe("given a legacy project API key", () => {
    describe("when the usage is read", () => {
      /** @scenario "A legacy project key cannot reach the v1 usage read" */
      it("refuses with the credential class mismatch code, naming the class to swap to", async () => {
        const res = await app.request(USAGE_PATH, {
          headers: bearer(legacyProjectKey),
        });

        expect(res.status).toBe(401);
        const body = await res.json();
        expect(body.code).toBe("credential_class_mismatch");
        expect(body.meta).toMatchObject({
          required: "organization_api_key",
          presented: "project_api_key",
        });
      });
    });
  });

  describe("given a user-bound key from another organization", () => {
    describe("when the usage is read for a pull request mapped elsewhere", () => {
      /** @scenario "An organization key from another organization learns nothing" */
      it("answers the not-mapped failure without confirming the mapping exists elsewhere", async () => {
        const res = await app.request(USAGE_PATH, {
          headers: bearer(otherOrgToken),
        });

        expect(res.status).toBe(404);
        const body = await res.json();
        expect(body.code).toBe("github_pr_not_mapped");
        // Nothing on the wire names the organization the mapping belongs to.
        expect(JSON.stringify(body)).not.toContain(organization.id);
      });
    });
  });

  describe("given the published API document", () => {
    const operation = (): {
      security?: unknown;
      responses?: Record<string, unknown>;
    } => {
      const paths = (
        publishedSpec as unknown as {
          paths?: Record<string, { get?: object }>;
        }
      ).paths;
      const op = paths?.[USAGE_SPEC_PATH]?.get;
      if (!op) {
        throw new Error(
          `GET ${USAGE_SPEC_PATH} is missing from the generated OpenAPI document`,
        );
      }
      return op;
    };

    it("publishes the route under the organization API key scheme", () => {
      // The stamped security is what tells an integrator which key to send:
      // the organization credential, never a project one.
      expect(operation().security).toEqual([{ admin_api_key: [] }]);
    });
  });
});
