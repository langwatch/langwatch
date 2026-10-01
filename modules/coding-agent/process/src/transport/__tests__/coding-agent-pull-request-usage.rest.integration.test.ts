import { bindRestMiddleware, createRestRuntime } from "@langwatch/api/rest";
import type { AuditLogApi, RecordAuditLogCommand } from "@langwatch/audit-log-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { DataRetentionApi } from "@langwatch/data-retention-contract";
import type { GovernanceRestApi } from "@langwatch/enterprise-governance-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { ResourceScope } from "@langwatch/process";
import { ScopedSecrets } from "@langwatch/secrets";
/**
 * @vitest-environment node
 * The project-scoped pull-request usage door: who it answers for, who it
 * refuses by name, and what it writes down about the read.
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { TraceApi } from "@langwatch/trace-contract";
import type { UserApi } from "@langwatch/user-contract";
import type { ErrorHandler } from "hono";
import { describe, expect, it, vi } from "vitest";

import { CodingAgentApp } from "#app/coding-agent.app";

import {
  TestGithubService,
  TestProjectService,
  pullRequest,
} from "../../__tests__/fixtures/coding-agent.fixture.ts";
import { MemoryCodingAgentRepositories } from "../../repositories/memory/memory.coding-agent.repositories.ts";
import { codingAgentRestCaller, codingAgentRollupRest } from "../coding-agent.rest.ts";

const USAGE_PATH = "/api/coding-agent/pull-request-usage?repository=acme/widgets&pullRequest=1";

const OTHER_WORKSPACE = "project_someone_else";

/** The two projects the holder may read; the key is bound to one of them. */
const OWNER_PROJECT = "project_owner";
const TEAMMATE_PROJECT = "project_teammate";

/** A workspace, as the personal-workspace guard reads one. */
type TestWorkspace = { id: string; isPersonal: boolean | null; ownerUserId: string | null };

/** A handled refusal reaches the caller at its own status with its own code. */
const renderHandled: ErrorHandler = (error, c) => {
  const handled = error as { status?: number; httpStatus?: number; code?: string };
  const status = handled.status ?? handled.httpStatus;

  return typeof status === "number"
    ? c.json({ error: handled.code ?? "error" }, status as never)
    : c.json({ error: String(error) }, 500);
};

class GithubForRest extends TestGithubService {
  readonly lookups: { prNumber: number }[] = [];

  constructor() {
    super();
    this.pullRequests = [pullRequest({ repositoryFullName: "acme/widgets" })];
  }

  override findByNumber(input: {
    prNumber: number;
  }): ReturnType<TestGithubService["findByNumber"]> {
    this.lookups.push(input);
    return super.findByNumber(input);
  }

  override getWebBase(): string {
    return "https://github.com";
  }
}

class ProjectForRest extends TestProjectService {
  constructor(organizationProjects: readonly string[]) {
    super();
    this.projects = organizationProjects.map((id) => ({ id }));
  }

  override getOrganizationId(): Promise<string> {
    return Promise.resolve("organization-1");
  }
}

/**
 * The whole door over the REAL application, so the projects the read is cut to
 * are the ones the scope port answered for the principal the transport handed
 * it — not a set the test decided for itself.
 */
function mount({
  project,
  apiKeyUserId,
  reach = { key: [OWNER_PROJECT], holder: [OWNER_PROJECT] },
}: {
  project: TestWorkspace;
  apiKeyUserId: string | null;
  reach?: { key: readonly string[]; holder: readonly string[] };
}) {
  const audits: RecordAuditLogCommand[] = [];
  const principals: Parameters<AuthzApi["canBatchPermissionsByIds"]>[0]["principal"][] = [];
  const github = new GithubForRest();
  const repositories = MemoryCodingAgentRepositories.create();
  const candidateReads = vi.spyOn(repositories.sessions, "findByRepositoryBranch");

  const app = CodingAgentApp.create({
    dependencies: {
      github,
      projects: new ProjectForRest([...new Set([...reach.key, ...reach.holder])]),
      traces: createApiFixture<TraceApi>({}),
      retention: createApiFixture<DataRetentionApi>({}),
      authz: createApiFixture<AuthzApi>({
        canBatchPermissionsByIds: async (args) => {
          principals.push(args.principal);
          const allowed = args.principal.type === "apiKey" ? reach.key : reach.holder;
          const projects = new Map(allowed.map((id) => [id, true]));
          return {
            byPermission: new Map(
              args.permissions.map((permission) => [
                permission,
                { projects, teams: new Map<string, boolean>() },
              ]),
            ),
            organizationRole: null,
          };
        },
      }),
      organizations: createApiFixture<OrganizationApi>({}),
      users: createApiFixture<UserApi>({}),
      governance: createApiFixture<GovernanceRestApi>({ isSourceBilled: async () => false }),
      auditLog: createApiFixture<AuditLogApi>({
        record: async (command) => {
          audits.push(command);
          return { id: "audit-1", occurredAt: 0 };
        },
      }),
    },
    members: {},
    config: undefined,
    repositories,
    resources: new ResourceScope(),
    secrets: new ScopedSecrets(async (_handle, build) => build(undefined)),
  });

  // The resolved credential, exactly as the process's own project
  // authentication installs it: the handler reads its principal off this and
  // never off loose context keys.
  const credential = {
    kind: "apiKey",
    apiKeyId: "key-1",
    userId: apiKeyUserId,
    organizationId: "organization-1",
    projectId: project.id,
    teamId: "team-1",
  } as const;

  const runtime = createRestRuntime({
    identity: {
      authenticate: () => ({
        actor: { type: "api_key", id: "key-1" } as const,
        scope: { tier: "project", id: project.id } as const,
      }),
    },
  });

  const hono = runtime.mount(codingAgentRollupRest.router(), {
    app: () => app,
    credential: "project",
    onError: renderHandled,
    facts: [
      bindRestMiddleware(codingAgentRestCaller, () => ({
        project: { isPersonal: project.isPersonal, ownerUserId: project.ownerUserId },
        credential,
      })),
    ],
  });

  return {
    audits,
    principals,
    github,
    reads: () =>
      candidateReads.mock.calls.map(([input]) => ({ permittedProjectIds: input.tenantIds })),
    fetch: () => hono.fetch(new Request(`http://api.test${USAGE_PATH}`)),
  };
}

describe("given the project-scoped pull request usage read", () => {
  describe("when a personal-workspace key reads a mapped pull request", () => {
    /** @scenario A pull request usage read over the API is recorded */
    it("records the read against the caller, the organization and the pull request without naming contributors", async () => {
      const api = mount({
        project: { id: OWNER_PROJECT, isPersonal: true, ownerUserId: "user-1" },
        apiKeyUserId: "user-1",
      });

      const response = await api.fetch();

      expect(response.status).toBe(200);
      expect(api.audits).toEqual([
        {
          userId: "user-1",
          organizationId: "organization-1",
          action: "codingAgents.pullRequestUsage",
          targetKind: "pullRequest",
          targetId: "github.com/acme/widgets#1",
          args: {
            repository: "acme/widgets",
            host: "github.com",
            pullRequest: 1,
            contributingProjectCount: 0,
          },
        },
      ]);
    });
  });

  describe("when the key belongs to a workspace that is not one person's", () => {
    /** @scenario A shared-workspace key cannot read pull request usage */
    it("refuses with the personal-workspace key required code and reads nothing", async () => {
      const api = mount({
        project: { id: "project_team", isPersonal: false, ownerUserId: null },
        apiKeyUserId: "user-1",
      });

      const response = await api.fetch();

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "personal_project_key_required" });
      expect(api.github.lookups).toEqual([]);
      expect(api.audits).toEqual([]);
    });
  });

  describe("when a user-bound key is pointed at another user's personal workspace", () => {
    /** @scenario A key cannot read another user's pull request usage */
    it("refuses with the key mismatch code and says nothing about whose workspace it is", async () => {
      const api = mount({
        project: { id: OTHER_WORKSPACE, isPersonal: true, ownerUserId: "user-2" },
        apiKeyUserId: "user-1",
      });

      const response = await api.fetch();

      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body).toEqual({ error: "personal_usage_key_mismatch" });
      expect(JSON.stringify(body)).not.toContain(OTHER_WORKSPACE);
      expect(JSON.stringify(body)).not.toContain("user-2");
      expect(api.github.lookups).toEqual([]);
    });
  });
});

describe("given a key bound to fewer projects than the person holding it", () => {
  describe("when that key reads the project-scoped rollup", () => {
    /** @scenario "A narrowed personal-workspace key reads with its own scope, not its holder's" */
    it("counts the key's own projects, never the holder's wider access", async () => {
      const api = mount({
        project: { id: OWNER_PROJECT, isPersonal: true, ownerUserId: "user-1" },
        apiKeyUserId: "user-1",
        reach: { key: [OWNER_PROJECT], holder: [OWNER_PROJECT, TEAMMATE_PROJECT] },
      });

      const response = await api.fetch();

      expect(response.status).toBe(200);
      expect(api.principals).toEqual([{ type: "apiKey", id: "key-1" }]);
      expect(api.reads()).toEqual([{ permittedProjectIds: [OWNER_PROJECT] }]);
    });
  });
});

describe("given a key for a personal workspace that belongs to no person", () => {
  describe("when it reads the project-scoped rollup", () => {
    /** @scenario "An ownerless key on the personal rollup is refused rather than answered as the owner" */
    it("refuses by name rather than answering as the workspace's owner", async () => {
      const api = mount({
        project: { id: OWNER_PROJECT, isPersonal: true, ownerUserId: "user-1" },
        apiKeyUserId: null,
      });

      const response = await api.fetch();

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        error: "personal_usage_service_key_unsupported",
      });
      expect(api.github.lookups).toEqual([]);
      expect(api.audits).toEqual([]);
    });
  });
});
