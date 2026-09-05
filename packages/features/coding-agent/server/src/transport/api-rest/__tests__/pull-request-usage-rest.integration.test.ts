/**
 * The project-scoped pull-request usage door: who it answers for, who it
 * refuses by name, and what it writes down about the read.
 * @see specs/coding-agent/pull-request-linkage.feature
 */
import { createAppRestSecurity, type AppRestSecurity } from "@langwatch/api/rest";
import { Hono, type ErrorHandler, type MiddlewareHandler } from "hono";
import { describe, expect, it, vi } from "vitest";

import { createCodingAgentRestApp } from "../coding-agent.api";

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
  const asProject: MiddlewareHandler = async (c, next) => {
    c.set("project", project);
    c.set("apiKeyId", "key-1");
    c.set("apiKeyUserId", apiKeyUserId);
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
