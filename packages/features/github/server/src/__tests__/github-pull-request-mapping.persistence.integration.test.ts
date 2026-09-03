/**
 * @vitest-environment node
 *
 * Package-owned persistence characterisation for GitHub branch mapping. The
 * external GitHub HTTP boundary is intercepted; the public composition adapter
 * owns the real mapping service and Prisma adapters.
 */
import { generateKeyPairSync } from "crypto";
import { GithubPrismaInstaller } from "@langwatch/github-server";
import {
  type GithubPullRequestEvent,
  type GithubService,
} from "@langwatch/github-contract";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import { type PrismaClient } from "@langwatch/prisma-client/generated";
import { cleanupTestRows } from "@langwatch/test-harness";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TestOrganizationService,
  TestProjectService,
} from "../services/__tests__/fixtures/github-services.fixture";

class AllowTestQueries extends PrismaQueryGuard {
  execute(_context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(_context.args);
  }
}

const databaseUrl = process.env.DATABASE_URL;
const connection = databaseUrl
  ? PrismaConnectionService.create({ guard: new AllowTestQueries() }).connect(
      PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }),
    )
  : null;

function database(): PrismaClient {
  if (connection === null)
    throw new Error("DATABASE_URL is required for this integration suite");
  return connection.client;
}

const namespace = `github-mapping-${nanoid(8)}`;
const repositoryFullName = `acme-${namespace}/widgets`;
const installationId = `test-${nanoid(12)}`;
const testGithubPrivateKey = generateKeyPairSync("rsa", { modulusLength: 2048 })
  .privateKey.export({ type: "pkcs1", format: "pem" })
  .toString();
let organizationId = "";
let projectId = "";

type GithubPullRequestSummary = GithubPullRequestEvent["pullRequest"];

function pullRequest(
  overrides: Partial<GithubPullRequestSummary> = {},
): GithubPullRequestSummary {
  return {
    number: 41,
    htmlUrl: `https://github.com/${repositoryFullName}/pull/41`,
    title: "Link sessions to pull requests",
    state: "open",
    draft: false,
    mergedAt: null,
    closedAt: null,
    createdAt: "2026-08-20T10:00:00.000Z",
    updatedAt: "2026-08-20T11:00:00.000Z",
    authorLogin: "octocat",
    ...overrides,
  };
}

function githubApiPullRequest(pull: GithubPullRequestSummary) {
  return {
    number: pull.number,
    html_url: pull.htmlUrl,
    title: pull.title,
    state: pull.state,
    draft: pull.draft,
    merged_at: pull.mergedAt,
    closed_at: pull.closedAt,
    created_at: pull.createdAt,
    updated_at: pull.updatedAt,
    user: pull.authorLogin ? { login: pull.authorLogin } : null,
  };
}

class GithubHttpFixture {
  readonly listingUrls: string[] = [];
  private pulls: readonly GithubPullRequestSummary[] = [];
  private pull: GithubPullRequestSummary | null = null;
  private pullResponse: () => Promise<Response> = () =>
    Promise.resolve(Response.json(this.pulls.map(githubApiPullRequest), { status: 200 }));

  setPulls(pulls: readonly GithubPullRequestSummary[]): void {
    this.pulls = pulls;
    this.pullResponse = () =>
      Promise.resolve(
        Response.json(this.pulls.map(githubApiPullRequest), { status: 200 }),
      );
  }

  setPullResponse(response: () => Promise<Response>): void {
    this.pullResponse = response;
  }

  setPull(pull: GithubPullRequestSummary): void {
    this.pull = pull;
  }

  async fetch(input: RequestInfo | URL): Promise<Response> {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const apiPath = url.pathname.replace(/^\/api\/v3/, "");
    if (apiPath === `/app/installations/${installationId}/access_tokens`) {
      return Response.json(
        {
          token: "test-installation-token",
          expires_at: "2026-08-21T12:00:00.000Z",
          repository_selection: "selected",
        },
        { status: 201 },
      );
    }
    if (
      apiPath.toLowerCase() === `/repos/acme-${namespace}/widgets/pulls`.toLowerCase()
    ) {
      this.listingUrls.push(url.toString());
      return await this.pullResponse();
    }
    if (
      apiPath.toLowerCase() ===
        `/repos/acme-${namespace}/widgets/pulls/${this.pull?.number ?? ""}`.toLowerCase() &&
      this.pull
    ) {
      return Response.json(githubApiPullRequest(this.pull));
    }
    return new Response("not found", { status: 404 });
  }
}

function webhook(input: {
  state: string;
  title: string;
  updatedAt: string;
  action?: string;
  installationId?: string;
  number?: number;
  headBranch?: string;
  mergedAt?: string | null;
  closedAt?: string | null;
}): GithubPullRequestEvent {
  const number = input.number ?? 41;
  return {
    action: input.action ?? "closed",
    installationId: input.installationId ?? installationId,
    repositoryOwner: `acme-${namespace}`,
    repositoryName: "widgets",
    headBranch: input.headBranch ?? "feat/webhook",
    pullRequest: pullRequest({
      number,
      htmlUrl: `https://github.com/${repositoryFullName}/pull/${number}`,
      state: input.state,
      title: input.title,
      updatedAt: input.updatedAt,
      mergedAt: input.mergedAt ?? null,
      closedAt: input.closedAt ?? null,
    }),
  };
}

function harness(input: { host?: string } = {}) {
  const http = new GithubHttpFixture();
  vi.stubGlobal("fetch", http.fetch.bind(http));
  const projects = new TestProjectService(organizationId);
  return {
    http,
    projects,
    github: GithubPrismaInstaller.create({
      database: database(),
      config: {
        appId: "test-app",
        privateKey: testGithubPrivateKey,
        appSlug: "test-app",
        webhookSecret: "test-webhook-secret",
        signingKey: "test-signing-key",
      },
      redis: null,
      organization: new TestOrganizationService(),
      project: projects,
      ...(input.host ? { hostConfig: { host: input.host } } : {}),
    }),
  } as const;
}

function branchRequest(headBranch: string, repositoryHost = "github.com") {
  return {
    tenantId: projectId,
    repositoryHost,
    repositoryOwner: `acme-${namespace}`,
    repositoryName: "widgets",
    headBranch,
  };
}

async function storedFor(
  github: GithubService,
  headBranch: string,
  repositoryHost = "github.com",
) {
  return await github.findAllByBranches({
    organizationId,
    repositoryHost,
    repositoryFullName,
    headBranches: [headBranch],
  });
}

async function branchCheck(headBranch: string, repositoryHost = "github.com") {
  return await database().githubBranchPullRequestCheck.findUnique({
    where: {
      organizationId_repositoryHost_repositoryFullName_headBranch: {
        organizationId,
        repositoryHost,
        repositoryFullName: repositoryFullName.toLowerCase(),
        headBranch,
      },
    },
  });
}

describe.skipIf(!databaseUrl)("GitHub pull-request mapping persistence", () => {
  beforeAll(async () => {
    const db = database();
    const organization = await db.organization.create({
      data: { name: namespace, slug: namespace },
    });
    organizationId = organization.id;
    const team = await db.team.create({
      data: { name: namespace, slug: namespace, organizationId },
    });
    const project = await db.project.create({
      data: {
        name: namespace,
        slug: namespace,
        apiKey: namespace,
        teamId: team.id,
        language: "typescript",
        framework: "other",
      },
    });
    projectId = project.id;
    await db.githubInstallation.upsert({
      where: { installationId },
      create: {
        installationId,
        organizationId,
        accountLogin: `acme-${namespace}`,
        accountType: "Organization",
        accountId: "1",
        repositorySelection: "selected",
        repositories: [{ id: "repository-1", fullName: repositoryFullName }],
      },
      update: { organizationId },
    });
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    await cleanupTestRows(database(), [
      ["githubPullRequest", { organizationId }],
      ["githubBranchPullRequestCheck", { organizationId }],
    ]);
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    try {
      if (organizationId !== "") {
        await cleanupTestRows(database(), [
          ["githubPullRequest", { organizationId }],
          ["githubBranchPullRequestCheck", { organizationId }],
          ["githubInstallation", { organizationId }],
          ["project", { id: projectId }],
          ["team", { organizationId }],
          ["organization", { id: organizationId }],
        ]);
      }
    } finally {
      await connection?.closeOnce();
    }
  });

  it("exposes the configured install and webhook values through the canonical service", () => {
    const { github } = harness();

    expect(github.getAppConfig()).toEqual({
      appSlug: "test-app",
      webhookSecret: "test-webhook-secret",
      configured: true,
    });
  });

  it("persists every discovered pull request and records activity only for the project whose session demanded it", async () => {
    const { github, http, projects } = harness();
    http.setPulls([
      pullRequest(),
      pullRequest({
        number: 42,
        htmlUrl: `https://github.com/${repositoryFullName}/pull/42`,
      }),
    ]);

    await github.requestBranchMapping({
      tenantId: projectId,
      repositoryHost: "GitHub.COM",
      repositoryOwner: `acme-${namespace}`,
      repositoryName: "widgets",
      headBranch: "feat/requested",
    });

    expect(http.listingUrls).toEqual([
      `https://api.github.com/repos/acme-${namespace}/widgets/pulls?head=acme-${namespace}%3Afeat%2Frequested&state=all&per_page=50`,
    ]);
    await expect(storedFor(github, "feat/requested")).resolves.toEqual([
      expect.objectContaining({ prNumber: 41, title: "Link sessions to pull requests" }),
      expect.objectContaining({ prNumber: 42 }),
    ]);
    await expect(branchCheck("feat/requested")).resolves.toMatchObject({
      prCount: 2,
      attempts: 0,
      recheckAfter: null,
    });
    expect(projects.pullRequestActivity).toHaveLength(1);
    expect(projects.pullRequestActivity[0]?.projectId).toBe(projectId);
  });

  it("backs off an empty branch and does not make a second GitHub call inside the recorded wait", async () => {
    const { github, http } = harness();
    http.setPulls([]);
    const request = {
      tenantId: projectId,
      repositoryHost: "github.com",
      repositoryOwner: `acme-${namespace}`,
      repositoryName: "widgets",
      headBranch: "feat/empty",
    };

    await github.requestBranchMapping(request);
    await github.requestBranchMapping(request);

    expect(http.listingUrls).toHaveLength(1);
    await expect(branchCheck("feat/empty")).resolves.toMatchObject({
      prCount: 0,
      attempts: 1,
      notFoundAt: expect.any(Date),
      recheckAfter: expect.any(Date),
    });
  });

  it("records a rate limit as a retryable backoff rather than a branch with no pull request", async () => {
    const { github, http } = harness();
    http.setPullResponse(() =>
      Promise.resolve(
        new Response("rate limited", { status: 429, headers: { "retry-after": "60" } }),
      ),
    );

    await expect(
      github.requestBranchMapping({
        tenantId: projectId,
        repositoryHost: "github.com",
        repositoryOwner: `acme-${namespace}`,
        repositoryName: "widgets",
        headBranch: "feat/rate-limited",
      }),
    ).resolves.toBeUndefined();

    await expect(branchCheck("feat/rate-limited")).resolves.toMatchObject({
      prCount: 0,
      attempts: 1,
      notFoundAt: null,
      recheckAfter: expect.any(Date),
    });
  });

  it("uses webhook facts immediately and leaves the newer merged snapshot intact when an old delivery arrives late", async () => {
    const { github, http } = harness();

    await expect(
      github.applyPullRequestEvent(
        webhook({
          state: "closed",
          title: "Merged title",
          updatedAt: "2026-08-20T12:00:00.000Z",
          mergedAt: "2026-08-20T12:00:00.000Z",
          closedAt: "2026-08-20T12:00:00.000Z",
        }),
      ),
    ).resolves.toBe(true);
    await github.applyPullRequestEvent(
      webhook({
        state: "open",
        title: "Stale title",
        updatedAt: "2026-08-20T11:00:00.000Z",
      }),
    );

    expect(http.listingUrls).toHaveLength(0);
    await expect(
      github.tryFindByNumber({
        organizationId,
        repositoryHost: "github.com",
        repositoryFullName,
        prNumber: 41,
      }),
    ).resolves.toMatchObject({
      state: "closed",
      title: "Merged title",
      prMergedAt: new Date("2026-08-20T12:00:00.000Z"),
    });
  });

  it("persists a live status that moved beyond the stored snapshot", async () => {
    const { github, http } = harness();
    await github.applyPullRequestEvent(
      webhook({
        state: "open",
        title: "Before merge",
        updatedAt: "2026-08-20T11:00:00.000Z",
      }),
    );
    http.setPull(
      pullRequest({
        state: "closed",
        title: "Merged",
        updatedAt: "2026-08-20T14:00:00.000Z",
        mergedAt: "2026-08-20T14:00:00.000Z",
        closedAt: "2026-08-20T14:00:00.000Z",
      }),
    );

    await expect(
      github.getLivePullRequestStatuses({
        organizationId,
        refs: [
          {
            repositoryHost: "github.com",
            repositoryFullName,
            prNumber: 41,
          },
        ],
      }),
    ).resolves.toMatchObject([{ status: "merged", source: "live" }]);

    await vi.waitFor(async () => {
      await expect(
        github.tryFindByNumber({
          organizationId,
          repositoryHost: "github.com",
          repositoryFullName,
          prNumber: 41,
        }),
      ).resolves.toMatchObject({
        state: "closed",
        title: "Merged",
        prMergedAt: new Date("2026-08-20T14:00:00.000Z"),
      });
    });
  });

  it("does not let an older live status overwrite a newer webhook snapshot", async () => {
    const { github, http } = harness();
    await github.applyPullRequestEvent(
      webhook({
        state: "closed",
        title: "Merged by webhook",
        updatedAt: "2026-08-20T14:00:00.000Z",
        mergedAt: "2026-08-20T14:00:00.000Z",
        closedAt: "2026-08-20T14:00:00.000Z",
      }),
    );
    http.setPull(
      pullRequest({
        state: "open",
        title: "Old live answer",
        updatedAt: "2026-08-20T11:00:00.000Z",
      }),
    );

    await github.getLivePullRequestStatuses({
      organizationId,
      refs: [
        {
          repositoryHost: "github.com",
          repositoryFullName,
          prNumber: 41,
        },
      ],
    });

    await vi.waitFor(async () => {
      await expect(
        github.tryFindByNumber({
          organizationId,
          repositoryHost: "github.com",
          repositoryFullName,
          prNumber: 41,
        }),
      ).resolves.toMatchObject({
        state: "closed",
        title: "Merged by webhook",
        prMergedAt: new Date("2026-08-20T14:00:00.000Z"),
      });
    });
  });

  it("does not write or call GitHub for a repository on another host", async () => {
    const { github, http } = harness();

    await github.requestBranchMapping({
      tenantId: projectId,
      repositoryHost: "github.example.test",
      repositoryOwner: `acme-${namespace}`,
      repositoryName: "widgets",
      headBranch: "feat/other-host",
    });

    expect(http.listingUrls).toHaveLength(0);
    await expect(
      database().githubBranchPullRequestCheck.findFirst({
        where: { organizationId, headBranch: "feat/other-host" },
      }),
    ).resolves.toBeNull();
  });

  it("does not resolve an installation or write linkage for a webhook action that changes no mapped field", async () => {
    const { github, http } = harness();

    await expect(
      github.applyPullRequestEvent(
        webhook({
          action: "labeled",
          state: "open",
          title: "Labels do not change linkage",
          updatedAt: "2026-08-20T12:00:00.000Z",
        }),
      ),
    ).resolves.toBe(false);

    expect(http.listingUrls).toHaveLength(0);
    await expect(storedFor(github, "feat/webhook")).resolves.toEqual([]);
    await expect(branchCheck("feat/webhook")).resolves.toBeNull();
  });

  it.each([
    "reopened",
    "closed",
    "edited",
    "ready_for_review",
    "converted_to_draft",
    "synchronize",
  ])(
    "persists a webhook action that changes a mapped pull-request field: %s",
    async (action) => {
      const { github } = harness();

      await expect(
        github.applyPullRequestEvent(
          webhook({
            action,
            state: action === "closed" ? "closed" : "open",
            title: `Mapped action ${action}`,
            updatedAt: "2026-08-20T12:00:00.000Z",
          }),
        ),
      ).resolves.toBe(true);

      await expect(storedFor(github, "feat/webhook")).resolves.toEqual([
        expect.objectContaining({ state: action === "closed" ? "closed" : "open" }),
      ]);
    },
  );

  it("does not persist a webhook for an installation this process has not recorded", async () => {
    const { github } = harness();

    await expect(
      github.applyPullRequestEvent(
        webhook({
          state: "open",
          title: "Unknown installation",
          updatedAt: "2026-08-20T12:00:00.000Z",
          installationId: `unknown-${nanoid(8)}`,
        }),
      ),
    ).resolves.toBe(false);

    await expect(storedFor(github, "feat/webhook")).resolves.toEqual([]);
    await expect(branchCheck("feat/webhook")).resolves.toBeNull();
  });

  it("keys Enterprise-host webhook and session linkage under the configured host", async () => {
    const host = "github.acme-corp.internal";
    const { github, http } = harness({ host });
    http.setPulls([pullRequest({ number: 75 })]);

    await github.applyPullRequestEvent(
      webhook({
        state: "open",
        title: "Enterprise webhook",
        updatedAt: "2026-08-20T12:00:00.000Z",
      }),
    );
    await github.requestBranchMapping(branchRequest("feat/enterprise", host));
    await github.requestBranchMapping(branchRequest("feat/no-host", ""));
    await github.requestBranchMapping(branchRequest("feat/public-host", "github.com"));

    expect(http.listingUrls).toHaveLength(2);
    await expect(storedFor(github, "feat/webhook", host)).resolves.toEqual([
      expect.objectContaining({ prNumber: 41, repositoryHost: host }),
    ]);
    await expect(branchCheck("feat/enterprise", host)).resolves.toMatchObject({
      prCount: 1,
    });
    await expect(branchCheck("feat/no-host", host)).resolves.toMatchObject({
      prCount: 1,
    });
    await expect(branchCheck("feat/public-host", host)).resolves.toBeNull();
  });

  it("does not attribute an empty listing or a webhook-only pull request to a project", async () => {
    const { github, http, projects } = harness();
    http.setPulls([]);

    await github.requestBranchMapping(branchRequest("feat/no-pull-request"));
    await github.applyPullRequestEvent(
      webhook({
        state: "open",
        title: "Webhook has no project owner",
        updatedAt: "2026-08-20T12:00:00.000Z",
      }),
    );

    expect(projects.pullRequestActivity).toEqual([]);
    await expect(storedFor(github, "feat/webhook")).resolves.toEqual([
      expect.objectContaining({ prNumber: 41 }),
    ]);
  });

  it("keeps a discovered mapping when the project activity recording fails", async () => {
    const { github, http, projects } = harness();
    http.setPulls([pullRequest({ number: 76 })]);
    projects.pullRequestActivityError = new Error("project database is unavailable");

    await expect(
      github.requestBranchMapping(branchRequest("feat/activity-failure")),
    ).resolves.toBeUndefined();

    await expect(storedFor(github, "feat/activity-failure")).resolves.toEqual([
      expect.objectContaining({ prNumber: 76 }),
    ]);
    expect(projects.pullRequestActivity).toEqual([]);
  });

  it("takes one atomic lookup claim when concurrent session folds ask about the same branch", async () => {
    const { github, http } = harness();
    let releaseListing: () => void = () => undefined;
    const listingHeld = new Promise<void>((resolve) => {
      releaseListing = resolve;
    });
    http.setPullResponse(async () => {
      await listingHeld;
      return Response.json([githubApiPullRequest(pullRequest({ number: 77 }))]);
    });
    const request = branchRequest("feat/concurrent");

    const first = github.requestBranchMapping(request);
    await vi.waitFor(() => expect(http.listingUrls).toHaveLength(1));
    const second = github.requestBranchMapping(request);
    releaseListing();
    await Promise.all([first, second]);

    expect(http.listingUrls).toHaveLength(1);
    await expect(storedFor(github, "feat/concurrent")).resolves.toEqual([
      expect.objectContaining({ prNumber: 77 }),
    ]);
  });

  it("rechecks a due, recently demanded empty branch without renewing its demand timestamp", async () => {
    const { github, http } = harness();
    http.setPulls([]);
    const headBranch = "feat/recheck";
    await github.requestBranchMapping(branchRequest(headBranch));
    const demandedAt = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000);
    await database().githubBranchPullRequestCheck.updateMany({
      where: { organizationId, headBranch },
      data: {
        lastRequestedAt: demandedAt,
        recheckAfter: new Date(0),
      },
    });
    http.setPulls([pullRequest({ number: 78 })]);

    await expect(branchCheck(headBranch)).resolves.toMatchObject({
      prCount: 0,
      recheckAfter: new Date(0),
    });
    await expect(
      github.coversRepository({ organizationId, repositoryFullName }),
    ).resolves.toBe(true);
    await expect(github.recheckDueBranches()).resolves.toBe(1);
    expect(http.listingUrls).toHaveLength(2);
    await expect(storedFor(github, headBranch)).resolves.toEqual([
      expect.objectContaining({ prNumber: 78 }),
    ]);
    await expect(branchCheck(headBranch)).resolves.toMatchObject({
      notFoundAt: null,
      recheckAfter: null,
      lastRequestedAt: demandedAt,
    });
  });

  it("leaves an abandoned branch out of the periodic recheck", async () => {
    const { github, http } = harness();
    http.setPulls([]);
    const headBranch = "feat/abandoned";
    await github.requestBranchMapping(branchRequest(headBranch));
    await database().githubBranchPullRequestCheck.updateMany({
      where: { organizationId, headBranch },
      data: {
        lastRequestedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000 - 1),
        recheckAfter: new Date(Date.now() - 1_000),
      },
    });

    await expect(github.recheckDueBranches()).resolves.toBe(0);
    expect(http.listingUrls).toHaveLength(1);
  });

  it("prunes abandoned bookkeeping but preserves mapped pull requests and maps the branch again on demand", async () => {
    const { github, http } = harness();
    http.setPulls([pullRequest({ number: 79 })]);
    const headBranch = "feat/pruned";
    const request = branchRequest(headBranch);
    await github.requestBranchMapping(request);
    await database().githubBranchPullRequestCheck.updateMany({
      where: { organizationId, headBranch },
      // The retention adapter deliberately compares its raw timestamp at
      // whole-second precision, so make the row unambiguously older.
      data: { lastRequestedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000 - 60_000) },
    });

    await expect(github.pruneStaleBranchLinkage()).resolves.toEqual({ branchChecks: 1 });
    await expect(branchCheck(headBranch)).resolves.toBeNull();
    await expect(storedFor(github, headBranch)).resolves.toEqual([
      expect.objectContaining({ prNumber: 79 }),
    ]);

    await github.requestBranchMapping(request);
    expect(http.listingUrls).toHaveLength(2);
    await expect(branchCheck(headBranch)).resolves.toMatchObject({
      prCount: 1,
    });
  });

  it("brings a live branch down from its longest empty-answer wait without repeating the GitHub call", async () => {
    const { github, http } = harness();
    http.setPulls([]);
    const headBranch = "feat/still-working";
    const request = branchRequest(headBranch);
    await github.requestBranchMapping(request);
    const staleDemand = new Date(Date.now() - 6 * 24 * 60 * 60 * 1_000);
    await database().githubBranchPullRequestCheck.updateMany({
      where: { organizationId, headBranch },
      data: {
        attempts: 4,
        recheckAfter: new Date(Date.now() + 24 * 60 * 60 * 1_000),
        lastRequestedAt: staleDemand,
      },
    });

    await github.requestBranchMapping(request);

    expect(http.listingUrls).toHaveLength(1);
    await expect(branchCheck(headBranch)).resolves.toMatchObject({
      attempts: 0,
      recheckAfter: expect.any(Date),
    });
    const check = await branchCheck(headBranch);
    expect(check?.recheckAfter?.getTime()).toBeLessThanOrEqual(
      Date.now() + 15 * 60 * 1_000,
    );
    expect(check?.lastRequestedAt.getTime()).toBeGreaterThan(staleDemand.getTime());
    expect(check?.lastRequestedAt.getTime()).toBeGreaterThan(Date.now() - 60_000);
  });

  it("resets an empty-branch backoff on a webhook without lowering an existing branch pull-request count", async () => {
    const { github, http } = harness();
    const headBranch = "feat/announcement";
    http.setPulls([
      pullRequest({ number: 80 }),
      pullRequest({
        number: 81,
        htmlUrl: `https://github.com/${repositoryFullName}/pull/81`,
      }),
    ]);
    await github.requestBranchMapping(branchRequest(headBranch));
    await database().githubBranchPullRequestCheck.updateMany({
      where: { organizationId, headBranch },
      data: {
        attempts: 4,
        notFoundAt: new Date(),
        recheckAfter: new Date(Date.now() + 24 * 60 * 60 * 1_000),
      },
    });

    await github.applyPullRequestEvent(
      webhook({
        number: 80,
        headBranch,
        state: "open",
        title: "Announced",
        updatedAt: "2026-08-20T13:00:00.000Z",
      }),
    );

    expect(http.listingUrls).toHaveLength(1);
    await expect(branchCheck(headBranch)).resolves.toMatchObject({
      prCount: 2,
      attempts: 0,
      notFoundAt: null,
      recheckAfter: null,
    });

    await github.applyPullRequestEvent(
      webhook({
        number: 80,
        headBranch,
        state: "open",
        title: "One announcement cannot lower the count",
        updatedAt: "2026-08-20T13:00:00.000Z",
      }),
    );
    await expect(branchCheck(headBranch)).resolves.toMatchObject({
      prCount: 2,
    });
  });

  it("keeps a newer webhook snapshot when an older GitHub listing finishes after it", async () => {
    const { github, http } = harness();
    let releaseListing: () => void = () => undefined;
    const listingHeld = new Promise<void>((resolve) => {
      releaseListing = resolve;
    });
    http.setPullResponse(async () => {
      await listingHeld;
      return Response.json([
        githubApiPullRequest(
          pullRequest({
            number: 82,
            state: "open",
            title: "Old listing",
            updatedAt: "2026-08-20T11:00:00.000Z",
          }),
        ),
      ]);
    });
    const listing = github.requestBranchMapping(branchRequest("feat/webhook"));

    await github.applyPullRequestEvent(
      webhook({
        number: 82,
        state: "closed",
        title: "Merged by webhook",
        updatedAt: "2026-08-20T14:00:00.000Z",
        mergedAt: "2026-08-20T14:00:00.000Z",
        closedAt: "2026-08-20T14:00:00.000Z",
      }),
    );
    releaseListing();
    await listing;

    await expect(
      github.tryFindByNumber({
        organizationId,
        repositoryHost: "github.com",
        repositoryFullName,
        prNumber: 82,
      }),
    ).resolves.toMatchObject({
      state: "closed",
      title: "Merged by webhook",
      prMergedAt: new Date("2026-08-20T14:00:00.000Z"),
    });
  });

  it("accepts equal source-time redelivery and a later snapshot for a legacy row without an ordering timestamp", async () => {
    const { github } = harness();
    const initial = webhook({
      state: "open",
      title: "Original",
      updatedAt: "2026-08-20T15:00:00.000Z",
    });
    await github.applyPullRequestEvent(initial);
    const initialMapping = await github.tryFindByNumber({
      organizationId,
      repositoryHost: "github.com",
      repositoryFullName,
      prNumber: 41,
    });
    await database().githubPullRequest.updateMany({
      where: { organizationId, prNumber: 41 },
      data: { title: "Drifted" },
    });
    await github.applyPullRequestEvent(initial);
    await database().githubPullRequest.updateMany({
      where: { organizationId, prNumber: 41 },
      data: { prUpdatedAt: null },
    });

    await github.applyPullRequestEvent(
      webhook({
        state: "closed",
        title: "Legacy row updated",
        updatedAt: "2026-08-20T16:00:00.000Z",
        closedAt: "2026-08-20T16:00:00.000Z",
        mergedAt: "2026-08-20T16:00:00.000Z",
      }),
    );

    await expect(
      github.tryFindByNumber({
        organizationId,
        repositoryHost: "github.com",
        repositoryFullName,
        prNumber: 41,
      }),
    ).resolves.toMatchObject({
      title: "Legacy row updated",
      state: "closed",
      prUpdatedAt: new Date("2026-08-20T16:00:00.000Z"),
      mappedAt: initialMapping?.mappedAt,
    });
  });
});
