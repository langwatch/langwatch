import type { AuditLogApi, RecordAuditLogCommand } from "@langwatch/audit-log-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import { CodingAgentApi } from "@langwatch/coding-agent-contract";
import type { DataRetentionApi } from "@langwatch/data-retention-contract";
import type { GovernanceRestApi } from "@langwatch/enterprise-governance-contract";
import { EventSourcing, InMemoryProcessStore } from "@langwatch/eventing";
import type { GithubApi } from "@langwatch/github-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { createApp, withMemoryRepositories } from "@langwatch/process";
import type { Project, ProjectApi } from "@langwatch/project-contract";
/**
 * @vitest-environment node
 * The organization rollup, booted the way a process boots coding-agent: its
 * caller scope, visibility and audit come from peers, never from members.
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { TraceApi } from "@langwatch/trace-contract";
import type { UserApi } from "@langwatch/user-contract";
import { describe, expect, it } from "vitest";

import { pullRequest } from "../../__tests__/fixtures/coding-agent.fixture.ts";
import { codingAgentServer } from "../../coding-agent.server.ts";

const ORGANIZATION = "organization-1";

function project(id: string, overrides: Partial<Project> = {}): Project {
  return {
    id,
    name: id,
    slug: id,
    apiKey: `legacy-${id}`,
    lwqlKey: `lwql-${id}`,
    teamId: `team-${id}`,
    language: "en",
    framework: "other",
    kind: "application",
    firstMessage: false,
    integrated: false,
    createdAt: new Date(0),
    updatedAt: new Date(0),
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
    personalFeatures: {},
    departmentId: null,
    langyEgressAllowlist: null,
    lastCodingAgentSessionAt: null,
    lastCodingAgentPullRequestAt: null,
    ...overrides,
  };
}

const RETAINED = { traces: 365, scenarios: 30, experiments: 30 };

function installation() {
  const authzAsks: Parameters<AuthzApi["canBatchPermissionsByIds"]>[0][] = [];
  const audits: RecordAuditLogCommand[] = [];
  const projects = [project("project-shared"), project("project-other")];

  const process = createApp({ role: "api" })
    .withModules([withMemoryRepositories(codingAgentServer)])
    .provide({
      project: createApiFixture<ProjectApi>({
        listByOrganization: async ({ page, limit }) => ({
          data: projects.slice((page - 1) * limit, page * limit),
          pagination: { page, limit, total: projects.length },
        }),
      }),
      github: createApiFixture<GithubApi>({
        normalizeRepositoryHost: (host) => host || "github.com",
        findByNumber: async () => pullRequest({ repositoryFullName: "acme/widgets" }),
        findAllByBranches: async () => [],
      }),
      trace: createApiFixture<TraceApi>(),
      "data-retention": createApiFixture<DataRetentionApi>({
        getResolvedForProject: async () => RETAINED,
      }),
      authz: createApiFixture<AuthzApi>({
        canBatchPermissionsByIds: async (args) => {
          authzAsks.push(args);
          return {
            byPermission: new Map(
              args.permissions.map((permission) => [
                permission,
                {
                  projects: new Map([["project-shared", true]]),
                  teams: new Map<string, boolean>(),
                },
              ]),
            ),
            organizationRole: null,
          };
        },
      }),
      organization: createApiFixture<OrganizationApi>({
        findPersonalTeamOwners: async () => [],
      }),
      user: createApiFixture<UserApi>(),
      governance: createApiFixture<GovernanceRestApi>({ isSourceBilled: async () => false }),
      "audit-log": createApiFixture<AuditLogApi>({
        record: async (command) => {
          audits.push(command);
          return { id: "audit-1", occurredAt: 0 };
        },
      }),
    });

  return { process, authzAsks, audits };
}

describe("given coding-agent installed the way a process installs it", () => {
  describe("when its pipeline is built", () => {
    /** @scenario "A module's pipeline declares each tenant's retention from data retention" */
    it("declares each tenant's retention as data retention resolves it", async () => {
      const { process } = installation();
      const eventing = new EventSourcing({
        enabled: false,
        processStore: InMemoryProcessStore.createForTesting(),
      });
      const runtime = await process.withEventing(eventing).boot();

      try {
        const pipeline = eventing.definitions.find(
          (definition) => definition.metadata.name === "coding_agent_processing",
        );

        await expect(
          pipeline?.open((definition) =>
            definition.retentionPolicyResolver?.resolve("project-shared"),
          ),
        ).resolves.toEqual(RETAINED);
      } finally {
        await runtime.stop();
      }
    });
  });

  describe("when an organization key reads a mapped pull request's usage", () => {
    /** @scenario The installed process answers the organization rollup instead of failing */
    it("resolves the caller's scope through the authorization peer and reaches the pull request", async () => {
      const { process, authzAsks } = installation();
      const runtime = await process.boot();

      try {
        const usage = await runtime.service(CodingAgentApi).getOrganizationPullRequestUsage(
          {
            organizationId: ORGANIZATION,
            repositoryHost: "github.com",
            repositoryFullName: "acme/widgets",
            prNumber: 1,
          },
          { kind: "apiKey", apiKeyId: "key-1", userId: null },
        );

        expect(usage.pullRequest.repositoryFullName).toBe("acme/widgets");
        expect(authzAsks).toEqual([
          {
            principal: { type: "apiKey", id: "key-1" },
            permissions: ["traces:view", "cost:view"],
            organizationId: ORGANIZATION,
            teams: [],
            projects: [
              { projectId: "project-shared", teamId: "team-project-shared" },
              { projectId: "project-other", teamId: "team-project-other" },
            ],
          },
        ]);
      } finally {
        await runtime.stop();
      }
    });
  });

  describe("when the read that names people is recorded", () => {
    /** @scenario A pull request usage read is written to the audit log */
    it("writes the entry through the audit log peer", async () => {
      const { process, audits } = installation();
      const runtime = await process.boot();

      try {
        await runtime.service(CodingAgentApi).recordPullRequestUsageRead({
          readerUserId: "user-1",
          organizationId: ORGANIZATION,
          repositoryHost: "github.com",
          repositoryFullName: "acme/widgets",
          prNumber: 1,
          contributingProjectCount: 2,
        });

        expect(audits).toEqual([
          {
            userId: "user-1",
            organizationId: ORGANIZATION,
            action: "codingAgents.pullRequestUsage",
            targetKind: "pullRequest",
            targetId: "github.com/acme/widgets#1",
            args: {
              repository: "acme/widgets",
              host: "github.com",
              pullRequest: 1,
              contributingProjectCount: 2,
            },
          },
        ]);
      } finally {
        await runtime.stop();
      }
    });
  });
});
