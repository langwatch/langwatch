/**
 * @vitest-environment node
 * The project-scoped pull-request usage door: who it answers for, who it
 * refuses by name, and what it writes down about the read.
 */
import { bindRestMiddleware, createRestRuntime } from "@langwatch/api/rest";
import type { CodingAgentPullRequestUsage } from "@langwatch/coding-agent-contract";
import { ResourceScope } from "@langwatch/kernel";
import { ScopedSecrets } from "@langwatch/secrets";
import type { ErrorHandler } from "hono";
import { describe, expect, it, vi } from "vitest";

import { CodingAgentApp } from "#app/coding-agent.app";
import type { CodingAgentSessionService } from "#services/coding-agent.service";

import {
  TestBillingPolicy,
  TestGithubService,
  TestProjectService,
  pullRequest,
} from "../../__tests__/fixtures/coding-agent.fixture.ts";
import type {
  CodingAgentAuditSink,
  CodingAgentViewerVisibilityReader,
} from "../../app/coding-agent.app.ts";
import {
  type CodingAgentCallerScopeDirectory,
  type CodingAgentScopePermission,
  type CodingAgentScopePermissions,
  type CodingAgentScopeCaller,
} from "../../app/coding-agent.members.ts";
import { MemoryCodingAgentRepositories } from "../../repositories/memory/memory.coding-agent.repositories.ts";
import { codingAgentRestCaller, codingAgentRollupRest } from "../coding-agent.rest.ts";

const USAGE_PATH = "/api/coding-agent/pull-request-usage?repository=acme/widgets&pullRequest=1";

const USAGE: CodingAgentPullRequestUsage = {
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

class NoVisibility implements CodingAgentViewerVisibilityReader {
  readVisibility(): Promise<{ canReadCapturedContent: boolean; canSeeCosts: boolean }> {
    return Promise.resolve({ canReadCapturedContent: true, canSeeCosts: true });
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
  const audits: Record<string, unknown>[] = [];
  const callers: CodingAgentScopeCaller[] = [];
  const reads: { permittedProjectIds: readonly string[] }[] = [];
  const getPullRequestUsage = vi.fn<
    (input: { permittedProjectIds: readonly string[] }) => Promise<CodingAgentPullRequestUsage>
  >(async (input) => {
    reads.push({ permittedProjectIds: input.permittedProjectIds });

    return USAGE;
  });

  class ScopeDirectory implements CodingAgentCallerScopeDirectory {
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

  class ScopePermissions implements CodingAgentScopePermissions {
    projectCuts(input: {
      caller: CodingAgentScopeCaller;
      organizationId: string;
      projects: readonly {
        id: string;
        name: string;
        slug: string;
        teamId: string;
        isPersonal: boolean;
      }[];
      permissions: readonly CodingAgentScopePermission[];
    }) {
      callers.push(input.caller);
      const allowed = new Set(input.caller.kind === "apiKey" ? reach.key : reach.holder);

      return Promise.resolve(
        new Map<CodingAgentScopePermission, ReadonlySet<string>>([
          ["traces:view", allowed],
          ["cost:view", allowed],
        ]),
      );
    }
  }

  class RecordingAudit implements CodingAgentAuditSink {
    async auditLog(entry: Record<string, unknown>): Promise<void> {
      audits.push(entry);
    }
  }

  const app = CodingAgentApp.create({
    dependencies: { github: new GithubForRest(), projects: new ProjectForRest() },
    members: {
      billing: new TestBillingPolicy(),
      scopeDirectory: new ScopeDirectory(),
      scopePermissions: new ScopePermissions(),
      visibility: new NoVisibility(),
      audit: new RecordingAudit(),
      service: TestCodingAgentSessionService.create({ getPullRequestUsage }),
    },
    config: undefined,
    repositories: MemoryCodingAgentRepositories.create(),
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
    callers,
    reads,
    getPullRequestUsage,
    fetch: () => hono.fetch(new Request(`http://api.test${USAGE_PATH}`)),
  };
}

class TestCodingAgentSessionService implements CodingAgentSessionService {
  static create({
    getPullRequestUsage,
  }: {
    getPullRequestUsage: CodingAgentSessionService["getPullRequestUsage"];
  }): TestCodingAgentSessionService {
    return new TestCodingAgentSessionService(getPullRequestUsage);
  }

  private constructor(
    private readonly getPullRequestUsageForTest: CodingAgentSessionService["getPullRequestUsage"],
  ) {}

  getSessionEvents(
    input: Parameters<CodingAgentSessionService["getSessionEvents"]>[0],
  ): ReturnType<CodingAgentSessionService["getSessionEvents"]> {
    return this.unimplemented("getSessionEvents", input);
  }
  findBySessionId(
    input: Parameters<CodingAgentSessionService["findBySessionId"]>[0],
  ): ReturnType<CodingAgentSessionService["findBySessionId"]> {
    return this.unimplemented("findBySessionId", input);
  }
  findSessionForTrace(
    input: Parameters<CodingAgentSessionService["findSessionForTrace"]>[0],
  ): ReturnType<CodingAgentSessionService["findSessionForTrace"]> {
    return this.unimplemented("findSessionForTrace", input);
  }
  listRecent(
    input: Parameters<CodingAgentSessionService["listRecent"]>[0],
  ): ReturnType<CodingAgentSessionService["listRecent"]> {
    return this.unimplemented("listRecent", input);
  }
  backfillPullRequestMappings(
    input: Parameters<CodingAgentSessionService["backfillPullRequestMappings"]>[0],
  ): ReturnType<CodingAgentSessionService["backfillPullRequestMappings"]> {
    return this.unimplemented("backfillPullRequestMappings", input);
  }
  getUsageTotals(
    input: Parameters<CodingAgentSessionService["getUsageTotals"]>[0],
  ): ReturnType<CodingAgentSessionService["getUsageTotals"]> {
    return this.unimplemented("getUsageTotals", input);
  }
  listForProject(
    input: Parameters<CodingAgentSessionService["listForProject"]>[0],
  ): ReturnType<CodingAgentSessionService["listForProject"]> {
    return this.unimplemented("listForProject", input);
  }
  linkTraceSessionsToPullRequests(
    input: Parameters<CodingAgentSessionService["linkTraceSessionsToPullRequests"]>[0],
  ): ReturnType<CodingAgentSessionService["linkTraceSessionsToPullRequests"]> {
    return this.unimplemented("linkTraceSessionsToPullRequests", input);
  }
  getPullRequestUsage(
    input: Parameters<CodingAgentSessionService["getPullRequestUsage"]>[0],
  ): ReturnType<CodingAgentSessionService["getPullRequestUsage"]> {
    return this.getPullRequestUsageForTest(input);
  }
  getPullRequestDetail(
    input: Parameters<CodingAgentSessionService["getPullRequestDetail"]>[0],
  ): ReturnType<CodingAgentSessionService["getPullRequestDetail"]> {
    return this.unimplemented("getPullRequestDetail", input);
  }
  getForPersonalProject(
    input: Parameters<CodingAgentSessionService["getForPersonalProject"]>[0],
  ): ReturnType<CodingAgentSessionService["getForPersonalProject"]> {
    return this.unimplemented("getForPersonalProject", input);
  }

  countUsage(
    input: Parameters<CodingAgentSessionService["countUsage"]>[0],
  ): ReturnType<CodingAgentSessionService["countUsage"]> {
    return this.unimplemented("countUsage", input);
  }

  private unimplemented(operation: string, _input: unknown): Promise<never> {
    return Promise.reject(
      new Error(`TestCodingAgentSessionService does not implement ${operation}`),
    );
  }
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
      expect(api.getPullRequestUsage).not.toHaveBeenCalled();
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
      expect(api.getPullRequestUsage).not.toHaveBeenCalled();
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
      expect(api.callers).toEqual([{ kind: "apiKey", apiKeyId: "key-1", userId: "user-1" }]);
      expect(api.reads).toEqual([{ permittedProjectIds: [OWNER_PROJECT] }]);
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
      expect(api.getPullRequestUsage).not.toHaveBeenCalled();
      expect(api.audits).toEqual([]);
    });
  });
});
