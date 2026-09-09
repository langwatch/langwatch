/**
 * The project-scoped pull-request usage door: who it answers for, who it
 * refuses by name, and what it writes down about the read.
 * @see specs/coding-agent/pull-request-linkage.feature
 */
import { createAppRestSecurity, type AppRestSecurity } from "@langwatch/api/rest";
import { Hono, type ErrorHandler, type MiddlewareHandler } from "hono";
import { describe, expect, it, vi } from "vitest";

import { CodingAgentApp } from "#app/coding-agent.app";
import { ResourceScope } from "@langwatch/runtime-composition";
import {
  TestBillingPolicy,
  TestGithubService,
  TestProjectService,
  pullRequest,
} from "../../../__tests__/fixtures/coding-agent.fixture.ts";
import {
  CodingAgentCallerScopeDirectoryPort,
  CodingAgentScopePermissionsPort,
} from "#ports/coding-agent-caller-scope.port";
import { CodingAgentService } from "@langwatch/coding-agent-contract";
import type { CodingAgentScopeCaller } from "#ports/coding-agent-caller-scope.port";
import { createCodingAgentRestApp } from "../coding-agent.api.ts";

const USAGE_PATH = "/api/coding-agent/pull-request-usage?repository=acme/widgets&pullRequest=1";

const USAGE = {
  pullRequest: {
    repositoryHost: "github.com",
    repositoryFullName: "acme/widgets",
    prNumber: 1,
    headBranch: "feat/linkage",
    htmlUrl: "https://github.com/acme/widgets/pull/1",
    state: "open",
    isDraft: false,
    authorLogin: "octocat",
    prCreatedAtMs: 1,
    prClosedAtMs: null,
    prMergedAtMs: null,
  },
  rows: [],
  totals: {
    sessionsCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    totalTokens: 0,
    costUsd: null,
    billedCostUsd: null,
    nonBilledCostUsd: null,
  },
  modelBreakdown: [],
};

const OTHER_WORKSPACE = "project_someone_else";

function mount(
  project: { id: string; isPersonal: boolean | null; ownerUserId: string | null },
  apiKeyUserId: string | null,
) {
  const audits: Array<Record<string, unknown>> = [];
  const getPullRequestUsage = vi.fn(async () => ({
    usage: USAGE,
    organizationId: "organization-1",
  }));

  const hono = new Hono().route(
    "/",
    createCodingAgentRestApp({
      security: projectSecurity(project, apiKeyUserId),
      app: () =>
        ({
          githubWebBase: () => "https://github.com",
          getPullRequestUsage,
        }) as never,
      audit: () =>
        ({
          auditLog: async (entry: Record<string, unknown>) => {
            audits.push(entry);
          },
        }) as never,
    }).at(-1) as never,
  );

  return {
    audits,
    getPullRequestUsage,
    fetch: () => hono.fetch(new Request(`http://api.test${USAGE_PATH}`)),
  };
}

const renderHandled: ErrorHandler = (error, c) => {
  const handled = error as { httpStatus?: number; code?: string };
  return typeof handled.httpStatus === "number"
    ? c.json({ error: handled.code ?? "error" }, handled.httpStatus as never)
    : c.json({ error: String(error) }, 500);
};

function projectSecurity(
  project: { id: string; isPersonal: boolean | null; ownerUserId: string | null },
  apiKeyUserId: string | null,
): AppRestSecurity {
  const noop: MiddlewareHandler = async (_c, next) => {
    await next();
  };
  // The resolved credential, exactly as the process's own project
  // authentication installs it: the handler reads its principal off this and
  // never off loose context keys.
  const asProject: MiddlewareHandler = async (c, next) => {
    c.set("project", project);
    c.set("resolvedToken", {
      type: "apiKey",
      apiKeyId: "key-1",
      userId: apiKeyUserId,
      organizationId: "organization-1",
      ingestSourceType: null,
      ingestionTemplateId: null,
      project: { ...project, teamId: "team-1" },
    });
    await next();
  };
  return createAppRestSecurity({
    appContext: noop,
    requestLogger: () => noop,
    requestTracer: () => noop,
    legacyErrorHandler: renderHandled,
    canonicalErrorHandler: renderHandled,
    authenticateProject: () => asProject,
    authorizeProjectPermission: () => noop,
    authorizeApiKeyCeiling: () => noop,
    authenticateOrganization: () => noop,
    authorizeOrganizationPermission: () => noop,
    authorizeRouteTeamPermission: () => noop,
    authorizeRouteProjectPermission: () => noop,
    authenticateOrganizationThrowing: noop,
    authorizeOrganizationPermissionThrowing: () => noop,
  } as never);
}

describe("given the project-scoped pull request usage read", () => {
  describe("when a personal-workspace key reads a mapped pull request", () => {
    /** @scenario A pull request usage read over the API is recorded */
    it("records the read against the caller, the organization and the pull request without naming contributors", async () => {
      const api = mount({ id: "project_owner", isPersonal: true, ownerUserId: "user-1" }, "user-1");

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
      const api = mount({ id: "project_team", isPersonal: false, ownerUserId: null }, "user-1");

      const response = await api.fetch();

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "personal_project_key_required" });
      expect(api.getPullRequestUsage).not.toHaveBeenCalled();
      expect(api.audits).toEqual([]);
    });
  });

  describe("when a user-bound key is pointed at another user's personal workspace", () => {
    /** @scenario A key cannot read another user's pull request usage */
    it("refuses with the key mismatch code and says nothing about whose workspace it is", async () => {
      const api = mount({ id: OTHER_WORKSPACE, isPersonal: true, ownerUserId: "user-2" }, "user-1");

      const response = await api.fetch();

      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body).toEqual({ error: "personal_usage_key_mismatch" });
      expect(JSON.stringify(body)).not.toContain(OTHER_WORKSPACE);
      expect(JSON.stringify(body)).not.toContain("user-2");
      expect(api.getPullRequestUsage).not.toHaveBeenCalled();
    });
  });
});

/** The two projects the holder may read; the key is bound to one of them. */
const OWNER_PROJECT = "project_owner";
const TEAMMATE_PROJECT = "project_teammate";

/**
 * The same door over the REAL application, so the projects the read is cut to
 * are the ones the scope port answered for the principal the transport handed
 * it — not a set the test decided for itself.
 */
function mountOverScope(reach: { key: readonly string[]; holder: readonly string[] }) {
  const callers: CodingAgentScopeCaller[] = [];
  const reads: Array<{ permittedProjectIds: readonly string[] }> = [];

  class ScopeDirectory extends CodingAgentCallerScopeDirectoryPort {
    listOrganizationProjects() {
      return Promise.resolve(
        [...new Set([...reach.key, ...reach.holder])].map((id) => ({
          id,
          name: id,
          slug: id,
          teamId: `team-${id}`,
          isPersonal: false,
        })),
      );
    }

    listPersonalTeamOwnerNames() {
      return Promise.resolve(new Map<string, string>());
    }
  }

  class ScopePermissions extends CodingAgentScopePermissionsPort {
    projectCuts(input: { caller: CodingAgentScopeCaller }) {
      callers.push(input.caller);
      const ids = input.caller.kind === "apiKey" ? reach.key : reach.holder;
      const allowed = new Set(ids);
      return Promise.resolve(
        new Map([
          ["traces:view", allowed],
          ["cost:view", allowed],
        ]),
      );
    }
  }

  class GithubForRest extends TestGithubService {
    constructor() {
      super();
      this.pullRequests = [pullRequest({ repositoryFullName: "acme/widgets" })];
    }

    override getWebBase(): string {
      return "https://github.com";
    }
  }

  class ProjectForRest extends TestProjectService {
    override getOrganizationId(): Promise<string> {
      return Promise.resolve("organization-1");
    }
  }

  const codingAgents = {
    getPullRequestUsage: async (input: { permittedProjectIds: readonly string[] }) => {
      reads.push({ permittedProjectIds: input.permittedProjectIds });
      return USAGE;
    },
  } as CodingAgentService;
  const app = CodingAgentApp.create({
    dependencies: { github: new GithubForRest(), projects: new ProjectForRest() },
    infrastructure: {
      clickHouse: null,
      defaultTraceRetentionDays: 30,
      billing: new TestBillingPolicy(),
      scopeDirectory: new ScopeDirectory(),
      scopePermissions: new ScopePermissions(),
      service: codingAgents,
    },
    config: undefined,
    resources: new ResourceScope(),
  });

  const hono = new Hono().route(
    "/",
    createCodingAgentRestApp({
      security: projectSecurity(
        { id: OWNER_PROJECT, isPersonal: true, ownerUserId: "user-1" },
        "user-1",
      ),
      app: () => app,
      audit: () => ({ auditLog: async () => undefined }) as never,
    }).at(-1) as never,
  );

  return {
    callers,
    reads,
    fetch: () => hono.fetch(new Request(`http://api.test${USAGE_PATH}`)),
  };
}

describe("given a key bound to fewer projects than the person holding it", () => {
  describe("when that key reads the project-scoped rollup", () => {
    /** @scenario "A narrowed personal-workspace key reads with its own scope, not its holder's" */
    it("counts the key's own projects, never the holder's wider access", async () => {
      const api = mountOverScope({
        key: [OWNER_PROJECT],
        holder: [OWNER_PROJECT, TEAMMATE_PROJECT],
      });

      const response = await api.fetch();

      expect(response.status).toBe(200);
      expect(api.callers).toEqual([{ kind: "apiKey", apiKeyId: "key-1", userId: "user-1" }]);
      expect(api.reads).toEqual([{ permittedProjectIds: [OWNER_PROJECT] }]);
    });
  });
});

describe("given a key for a personal workspace that belongs to no person", () => {
  describe("when it reads the project-scoped rollup", () => {
    /**
     * @scenario "An ownerless key on the personal rollup is refused rather than answered as the owner"
     */
    it("refuses by name rather than answering as the workspace's owner", async () => {
      const api = mount({ id: OWNER_PROJECT, isPersonal: true, ownerUserId: "user-1" }, null);

      const response = await api.fetch();

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        error: "personal_usage_service_key_unsupported",
      });
      expect(api.getPullRequestUsage).not.toHaveBeenCalled();
      expect(api.audits).toEqual([]);
    });
  });
});
