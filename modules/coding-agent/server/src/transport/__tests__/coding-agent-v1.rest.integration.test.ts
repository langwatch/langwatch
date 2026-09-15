/**
 * @vitest-environment node
 * The organization-keyed pull-request usage door, driven through the runtime a
 * process mounts the declaration on.
 * Spec: specs/coding-agent/pull-request-linkage.feature
 */
import {
  bindRestMiddleware,
  createRestRuntime,
  getRoutePolicy,
  type RestErrorHandler,
} from "@langwatch/api/rest";
import type { CodingAgentApi, CodingAgentPullRequestUsage } from "@langwatch/coding-agent-contract";
import { GithubPullRequestNotMappedError } from "@langwatch/github-contract";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { describe, expect, it, vi } from "vitest";

import { codingAgentV1Rest, codingAgentV1RestCaller } from "../coding-agent-v1.rest.ts";

const ROLLUP: CodingAgentPullRequestUsage = {
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
      const api = mount({});

      const response = await api.fetch();

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual(ROLLUP);
      // The organization is the credential's, and the caller is the KEY: the
      // request named no project, and nothing recovered a person from one.
      expect(api.getOrganizationPullRequestUsage).toHaveBeenCalledWith(
        {
          organizationId: "organization-1",
          repositoryHost: "github.com",
          repositoryFullName: "acme/widgets",
          prNumber: 42,
        },
        { kind: "apiKey", apiKeyId: "key-1", userId: "user-1" },
      );
      expect(api.recordPullRequestUsageRead).toHaveBeenCalledWith({
        readerUserId: "user-1",
        organizationId: "organization-1",
        repositoryHost: "github.com",
        repositoryFullName: "acme/widgets",
        prNumber: 42,
        contributingProjectCount: 1,
      });
    });
  });
});

describe("given an organization key created without a user", () => {
  describe("when the rollup is read with it", () => {
    it("acts as nobody rather than inventing a person, and is recorded by key identity", async () => {
      const api = mount({ apiKeyUserId: null });

      await api.fetch();

      expect(api.getOrganizationPullRequestUsage).toHaveBeenCalledWith(expect.anything(), {
        kind: "apiKey",
        apiKeyId: "key-1",
        userId: null,
      });
      expect(api.recordPullRequestUsageRead).toHaveBeenCalledWith(
        expect.objectContaining({ readerUserId: "apikey:key-1" }),
      );
    });
  });
});

describe("given an organization key from a different organization", () => {
  describe("when the rollup is read for a pull request mapped elsewhere", () => {
    /** @scenario "An organization key from another organization learns nothing" */
    it("asks only about its own organization and answers not mapped", async () => {
      const api = mount({
        organizationId: "organization-elsewhere",
        readUsage: () => {
          throw new GithubPullRequestNotMappedError({
            repositoryFullName: "acme/widgets",
            prNumber: 42,
          });
        },
      });

      const response = await api.fetch();
      const body = (await response.json()) as { code?: string; message?: string };

      // The organization it asked about is its own. Another organization's
      // mapping is not reachable by naming the repository, so the answer
      // carries no trace of one existing.
      expect(api.getOrganizationPullRequestUsage).toHaveBeenCalledWith(
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
      mount({});

      const route = getRoutePolicy("GET", "/api/v1/coding-agent/pull-request-usage");

      // The class is derived by the runtime from the door the declaration
      // named, so it is what the mount ENFORCES rather than what it
      // advertises: a legacy project key carries no organization and cannot
      // satisfy it.
      expect(route?.credential).toBe("organization");
      expect(route?.credentialClass).toBe("organization_api_key");
    });

    it("refuses a process that tries to mount it behind the project door", () => {
      expect(() => mount({ credential: "project" })).toThrow(/declares the "organization" door/);
    });
  });
});

interface Overrides {
  /** What the application answers, or throws, for the rollup read. */
  readUsage?: () => CodingAgentPullRequestUsage;
  organizationId?: string;
  apiKeyUserId?: string | null;
  /** The door a process names at the mount, when it disagrees with the declaration. */
  credential?: "project";
}

/**
 * The whole door on the runtime a process mounts it on: the organization the
 * credential resolved, the caller fact the process binds, and an application
 * that only answers this one question.
 */
function mount(overrides: Overrides) {
  const organizationId = overrides.organizationId ?? "organization-1";
  const apiKeyUserId = overrides.apiKeyUserId === undefined ? "user-1" : overrides.apiKeyUserId;
  const readUsage = overrides.readUsage ?? (() => ROLLUP);

  const getOrganizationPullRequestUsage = vi.fn(async () => readUsage());
  const recordPullRequestUsageRead = vi.fn(async () => {});

  const runtime = createRestRuntime({
    identity: {
      identify: () => ({
        actor: apiKeyUserId
          ? ({ type: "user", id: apiKeyUserId } as const)
          : ({ type: "api_key", id: "key-1" } as const),
        scope: { tier: "organization", id: organizationId } as const,
      }),
    },
  });

  const hono = runtime.mount(codingAgentV1Rest.router(), {
    app: () =>
      ({
        githubWebBase: () => "https://github.com",
        getOrganizationPullRequestUsage,
        recordPullRequestUsageRead,
      }) as unknown as CodingAgentApi,
    ...(overrides.credential ? { credential: overrides.credential } : {}),
    onError: renderHandled,
    facts: [
      // The same fact the module's own server declaration binds: the key, the
      // member it acts as, and the one stable actor string the read is
      // recorded under.
      bindRestMiddleware(codingAgentV1RestCaller, () => ({
        apiKeyId: "key-1",
        userId: apiKeyUserId,
        actorId: apiKeyUserId ?? "apikey:key-1",
      })),
    ],
  });

  return {
    getOrganizationPullRequestUsage,
    recordPullRequestUsageRead,
    fetch: () => hono.fetch(new Request(`http://api.test${USAGE_PATH}`)),
  };
}

/** A handled refusal must reach the caller at its own status with its own code. */
const renderHandled: RestErrorHandler = (error, c) => {
  const handled = error as { status?: number; httpStatus?: number; code?: string; message?: string };
  const status = handled.status ?? handled.httpStatus;

  return typeof status === "number"
    ? c.json(
        { code: handled.code ?? "error", message: handled.message ?? "" },
        status as ContentfulStatusCode,
      )
    : c.json({ error: String(error) }, 500);
};
