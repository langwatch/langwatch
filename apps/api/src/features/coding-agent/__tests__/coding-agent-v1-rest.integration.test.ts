/**
 * The organization-keyed pull-request usage door, driven through the real Hono
 * app the API process mounts.
 *
 * What is pinned here is the door's own decisions, which are the three the v1
 * family exists to make: the organization comes from the CREDENTIAL and from
 * nowhere in the request, the caller handed to the application is the KEY
 * rather than the person who created it, and the read is recorded before the
 * answer leaves. The per-project cut those decisions feed is proved against
 * the real authorization engine in
 * `apps/api/src/app/__tests__/api-coding-agent-caller-scope.unit.test.ts`.
 *
 * Spec: specs/coding-agent/pull-request-linkage.feature
 */
import { createAppRestSecurity, getRoutePolicy, type AppRestSecurity } from "@langwatch/api/rest";
import { createCodingAgentV1RestApp } from "@langwatch/coding-agent-server";
import { GithubPullRequestNotMappedError } from "@langwatch/github-contract";
import { Hono, type ErrorHandler, type MiddlewareHandler } from "hono";
import { describe, expect, it, vi } from "vitest";

const ROLLUP = {
  pullRequest: {
    repositoryHost: "github.com",
    repositoryFullName: "acme/widgets",
    prNumber: 42,
    headBranch: "feat/linkage",
    htmlUrl: "https://github.com/acme/widgets/pull/42",
    state: "open",
    isDraft: false,
    authorLogin: "octocat",
    prCreatedAtMs: 1,
    prClosedAtMs: null,
    prMergedAtMs: null,
  },
  rows: [
    {
      projectId: "project-bound",
      projectSlug: "bound",
      contributorLabel: "Bound",
      contributorIsProject: true,
      agent: "claude-code",
      models: ["gpt-5-mini"],
      sessionsCount: 1,
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 10,
      cacheCreationTokens: 5,
      totalTokens: 165,
      costUsd: null,
      billedCostUsd: null,
      nonBilledCostUsd: null,
    },
  ],
  totals: {
    sessionsCount: 1,
    inputTokens: 100,
    outputTokens: 50,
    cacheReadTokens: 10,
    cacheCreationTokens: 5,
    totalTokens: 165,
    costUsd: null,
    billedCostUsd: null,
    nonBilledCostUsd: null,
  },
  modelBreakdown: [],
};

const USAGE_PATH = "/api/v1/coding-agent/pull-request-usage?repository=acme/widgets&pullRequest=42";

describe("given a user-bound organization key", () => {
  describe("when the rollup is read with no project id anywhere in the request", () => {
    /** @scenario "An organization key reads pull request usage without naming a project" */
    it("answers the credential's organization-wide rollup and records the read", async () => {
      const getOrganizationPullRequestUsage = vi.fn(async () => ROLLUP);
      const auditLog = vi.fn(async () => {});
      const api = mount({ getOrganizationPullRequestUsage, auditLog });

      const response = await api.fetch(USAGE_PATH);

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual(ROLLUP);
      // The organization is the credential's, and the caller is the KEY: the
      // request named no project, and nothing recovered a person from one.
      expect(getOrganizationPullRequestUsage).toHaveBeenCalledWith(
        {
          organizationId: "organization-1",
          repositoryHost: "github.com",
          repositoryFullName: "acme/widgets",
          prNumber: 42,
        },
        { kind: "apiKey", apiKeyId: "key-1", userId: "user-1" },
      );
      expect(auditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user-1",
          organizationId: "organization-1",
          action: "codingAgents.pullRequestUsage",
          targetKind: "pullRequest",
          targetId: "github.com/acme/widgets#42",
        }),
      );
    });
  });
});

describe("given an organization key created without a user", () => {
  describe("when the rollup is read with it", () => {
    it("acts as nobody rather than inventing a person, and is recorded by key identity", async () => {
      const getOrganizationPullRequestUsage = vi.fn(async () => ROLLUP);
      const auditLog = vi.fn(async () => {});
      const api = mount({
        getOrganizationPullRequestUsage,
        auditLog,
        apiKeyUserId: null,
      });

      await api.fetch(USAGE_PATH);

      expect(getOrganizationPullRequestUsage).toHaveBeenCalledWith(expect.anything(), {
        kind: "apiKey",
        apiKeyId: "key-1",
        userId: null,
      });
      expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({ userId: "apikey:key-1" }));
    });
  });
});

describe("given an organization key from a different organization", () => {
  describe("when the rollup is read for a pull request mapped elsewhere", () => {
    /** @scenario "An organization key from another organization learns nothing" */
    it("asks only about its own organization and answers not mapped", async () => {
      const getOrganizationPullRequestUsage = vi.fn(async () => {
        throw new GithubPullRequestNotMappedError({
          repositoryFullName: "acme/widgets",
          prNumber: 42,
        });
      });
      const api = mount({
        getOrganizationPullRequestUsage,
        auditLog: vi.fn(async () => {}),
        organizationId: "organization-elsewhere",
      });

      const response = await api.fetch(USAGE_PATH);
      const body = (await response.json()) as { code?: string; message?: string };

      // The organization it asked about is its own. Another organization's
      // mapping is not reachable by naming the repository, so the answer
      // carries no trace of one existing.
      expect(getOrganizationPullRequestUsage).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: "organization-elsewhere" }),
        expect.anything(),
      );
      expect(body.code).toBe(
        new GithubPullRequestNotMappedError({
          repositoryFullName: "acme/widgets",
          prNumber: 42,
        }).code,
      );
      expect(JSON.stringify(body)).not.toContain("organization-1");
    });
  });
});

describe("given the family as the process publishes it", () => {
  describe("when the route's declared credential is read back", () => {
    /** @scenario "A legacy project key cannot reach the v1 usage read" */
    it("declares the organization key, so a project credential never authenticates here", () => {
      mount({ getOrganizationPullRequestUsage: vi.fn(), auditLog: vi.fn() });

      const route = getRoutePolicy("GET", "/api/v1/coding-agent/pull-request-usage");

      // The class is derived by the builder from the app's scope, so it is
      // what the door ENFORCES rather than what it advertises: a legacy
      // project key carries no organization and cannot satisfy it.
      expect(route?.credentialClass).toBe("organization_api_key");
      expect(route?.policy.kind).toBe("anyAuthenticated");
    });
  });
});

interface Overrides {
  getOrganizationPullRequestUsage: (...args: never[]) => unknown;
  auditLog: (...args: never[]) => unknown;
  organizationId?: string;
  apiKeyUserId?: string | null;
}

function mount(overrides: Overrides) {
  const hono = new Hono().route(
    "/",
    createCodingAgentV1RestApp({
      security: passThroughSecurity({
        organizationId: overrides.organizationId ?? "organization-1",
        apiKeyUserId: overrides.apiKeyUserId === undefined ? "user-1" : overrides.apiKeyUserId,
      }),
      app: () =>
        ({
          githubWebBase: () => "https://github.com",
          getOrganizationPullRequestUsage: overrides.getOrganizationPullRequestUsage,
        }) as never,
      audit: () => ({ auditLog: overrides.auditLog }) as never,
    }).hono,
  );
  return {
    fetch: (path: string, init?: RequestInit) =>
      hono.fetch(new Request(`http://api.test${path}`, init)),
  };
}

function passThroughSecurity(credential: {
  organizationId: string;
  apiKeyUserId: string | null;
}): AppRestSecurity {
  const noop: MiddlewareHandler = async (_c, next) => {
    await next();
  };
  const asOrganization: MiddlewareHandler = async (c, next) => {
    c.set("organization", { id: credential.organizationId });
    c.set("apiKeyId", "key-1");
    c.set("apiKeyUserId", credential.apiKeyUserId);
    await next();
  };
  return createAppRestSecurity({
    appContext: noop,
    requestLogger: () => noop,
    requestTracer: () => noop,
    legacyErrorHandler: renderHandled,
    canonicalErrorHandler: renderHandled,
    authenticateProject: () => noop,
    authorizeProjectPermission: () => noop,
    authorizeApiKeyCeiling: () => noop,
    authenticateOrganization: () => asOrganization,
    authorizeOrganizationPermission: () => noop,
    authorizeRouteProjectPermission: () => noop,
    authenticateOrganizationThrowing: noop,
    authorizeOrganizationPermissionThrowing: () => noop,
  } as never);
}

/** A handled refusal must reach the caller at its own status with its own code. */
const renderHandled: ErrorHandler = (error, c) => {
  const handled = error as { httpStatus?: number; code?: string; message?: string };
  if (typeof handled.httpStatus === "number") {
    return c.json(
      { code: handled.code ?? "error", message: handled.message ?? "" },
      handled.httpStatus as never,
    );
  }
  return c.json({ error: String(error) }, 500);
};
