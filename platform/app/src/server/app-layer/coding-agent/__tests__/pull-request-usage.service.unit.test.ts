/**
 * @vitest-environment node
 * @unit
 *
 * The shape of the usage answer: what it groups by, what it sums, and (the
 * part worth a test of its own) what it can never carry.
 *
 * @see specs/coding-agent/pull-request-linkage.feature
 */
import { describe, expect, it, vi } from "vitest";
import type { GithubPullRequestRow } from "../../github/repositories/github-pull-requests.repository";
import { traced } from "../../tracing";
import type { PersonalSessionLookup } from "../pull-request-usage.service";
import { PullRequestUsageService } from "../pull-request-usage.service";
import type { CodingAgentBranchSessionRow } from "../repositories/coding-agent-session.repository";
import type { SessionModelTotalsRow } from "../repositories/coding-agent-session-events.repository";

const HOUR = 60 * 60 * 1000;
const NOW = Date.UTC(2026, 5, 1);

function pullRequestRow(
  over: Partial<GithubPullRequestRow> = {},
): GithubPullRequestRow {
  return {
    organizationId: "org-1",
    repositoryHost: "github.com",
    repositoryFullName: "acme/widgets",
    headBranch: "feat/linkage",
    prNumber: 7,
    htmlUrl: "https://github.com/acme/widgets/pull/7",
    title: "Link sessions to pull requests",
    state: "open",
    isDraft: false,
    authorLogin: "someone",
    prCreatedAt: new Date(NOW - 10 * HOUR),
    prClosedAt: null,
    prMergedAt: null,
    mappedAt: new Date(NOW - 10 * HOUR),
    lastCheckedAt: new Date(NOW),
    ...over,
  };
}

function sessionRow(
  over: Partial<CodingAgentBranchSessionRow> = {},
): CodingAgentBranchSessionRow {
  return {
    sessionId: "session-a",
    tenantId: "project-1",
    startedAtMs: NOW - 5 * HOUR,
    // A session whose fold never recorded a last event, which is the shape
    // most of these cases care nothing about: recency then falls back to the
    // start time.
    lastEventOccurredAtMs: 0,
    inputTokens: 100,
    outputTokens: 50,
    cacheReadTokens: 20,
    cacheCreationTokens: 10,
    costUsd: 1.5,
    agent: "claude_code",
    models: ["claude-fable-5"],
    userId: "user-abc",
    gitBranch: "feat/linkage",
    ...over,
  };
}

/** One row of the personal page's own session read, as ClickHouse returns it. */
function personalSessionRow(
  over: Partial<
    Awaited<ReturnType<PersonalSessionLookup["listRecent"]>>[number]
  > = {},
): Awaited<ReturnType<PersonalSessionLookup["listRecent"]>>[number] {
  return {
    sessionId: "session-a",
    startedAtMs: NOW - 5 * HOUR,
    lastEventOccurredAt: 0,
    agent: "claude_code",
    repositoryHost: "github.com",
    repositoryOwner: "acme",
    repositoryName: "widgets",
    gitBranch: "feat/linkage",
    inputTokens: 100,
    outputTokens: 50,
    cacheReadTokens: 20,
    cacheCreationTokens: 10,
    costUsd: 1.5,
    models: ["claude-opus-5"],
    ...over,
  };
}

/** One (session, model) total, as the per-call fact table returns it. */
function modelTotalsRow(
  over: Partial<SessionModelTotalsRow> = {},
): SessionModelTotalsRow {
  return {
    tenantId: "project-1",
    sessionId: "session-a",
    model: "claude-fable-5",
    inputTokens: 100,
    outputTokens: 50,
    cacheReadTokens: 20,
    cacheCreationTokens: 10,
    costUsd: 1.5,
    ...over,
  };
}

/** Nothing is bundled unless a case says so. */
const allBilled = async () => false;

/**
 * The mapping lookup answering only for the spelling it was asked about, so a
 * key the service failed to fold produces a visibly empty result rather than
 * being quietly forgiven. Deliberately stricter than the Prisma repository,
 * which folds host and repository itself: the service has to arrive with one
 * key per repository regardless, because the group it built is also what the
 * page renders as a row.
 */
function findAllByBranchesLike(rows: GithubPullRequestRow[]) {
  return vi.fn(
    async ({
      repositoryHost,
      repositoryFullName,
      headBranches,
    }: {
      repositoryHost: string;
      repositoryFullName: string;
      headBranches: readonly string[];
    }) =>
      rows.filter(
        (row) =>
          row.repositoryHost === repositoryHost &&
          row.repositoryFullName === repositoryFullName.toLowerCase() &&
          headBranches.includes(row.headBranch),
      ),
  );
}

function serviceWith({
  pullRequests,
  sessions,
  modelTotals = [],
  isSourceNonBillable = allBilled,
}: {
  pullRequests: GithubPullRequestRow[];
  sessions: CodingAgentBranchSessionRow[];
  modelTotals?: SessionModelTotalsRow[];
  isSourceNonBillable?: (params: {
    organizationId: string;
    sourceType: string;
  }) => Promise<boolean>;
}) {
  const listByRepositoryBranch = vi.fn().mockResolvedValue(sessions);
  const sumTokensByModelPerSession = vi.fn().mockResolvedValue(modelTotals);
  const service = new PullRequestUsageService({
    pullRequests: {
      findByNumber: vi.fn().mockResolvedValue(pullRequests[0] ?? null),
      findAllByBranches: vi.fn().mockResolvedValue(pullRequests),
    } as never,
    sessions: { listByRepositoryBranch } as never,
    personalSessions: { listRecent: vi.fn().mockResolvedValue([]) },
    sessionEvents: { sumTokensByModelPerSession },
    installations: { coversRepository: vi.fn().mockResolvedValue(true) },
    resolveOrganizationId: async () => "org-1",
    isSourceNonBillable,
    now: () => NOW,
  });
  return { service, listByRepositoryBranch, sumTokensByModelPerSession };
}

/** A personal workspace: named by the person who owns it, never linked. */
const PERSONAL_PROJECT = {
  slug: "riley-personal",
  contributorLabel: "Riley Chase",
  isLinkable: false,
};

/** A shared project: named by itself, and its name opens its traces. */
const SHARED_PROJECT = {
  slug: "gateway",
  contributorLabel: "Gateway",
  isLinkable: true,
};

const QUERY = {
  organizationId: "org-1",
  repositoryHost: "github.com",
  repositoryFullName: "acme/widgets",
  prNumber: 7,
  permittedProjectIds: ["project-1"],
  costProjectIds: ["project-1"],
  projects: { "project-1": PERSONAL_PROJECT },
};

const PERSONAL_QUERY = {
  projectId: "project-1",
  permittedProjectIds: ["project-1"],
  costProjectIds: ["project-1"],
  projects: { "project-1": PERSONAL_PROJECT },
};

/** Both projects readable: the caller's own workspace and a shared project. */
const BOTH_PROJECTS = {
  permittedProjectIds: ["project-1", "project-2"],
  costProjectIds: ["project-1", "project-2"],
  projects: { "project-1": PERSONAL_PROJECT, "project-2": SHARED_PROJECT },
};

/**
 * The personal page's two reads wired separately: `personalSessions` is what
 * DISCOVERS the pull requests, `sessions` is the organization-wide read that
 * PRICES them. Keeping them distinct is the whole point of the split.
 */
function personalServiceWith({
  pullRequests,
  personalSessions,
  organizationSessions = [],
  modelTotals = [],
  isSourceNonBillable = allBilled,
  findAllByBranches = vi.fn().mockResolvedValue(pullRequests),
}: {
  pullRequests: GithubPullRequestRow[];
  personalSessions: Awaited<ReturnType<PersonalSessionLookup["listRecent"]>>;
  organizationSessions?: CodingAgentBranchSessionRow[];
  modelTotals?: SessionModelTotalsRow[];
  isSourceNonBillable?: (params: {
    organizationId: string;
    sourceType: string;
  }) => Promise<boolean>;
  findAllByBranches?: ReturnType<typeof vi.fn>;
}) {
  const listByRepositoryBranch = vi
    .fn()
    .mockResolvedValue(organizationSessions);
  const service = new PullRequestUsageService({
    pullRequests: { findByNumber: vi.fn(), findAllByBranches } as never,
    sessions: { listByRepositoryBranch } as never,
    personalSessions: {
      listRecent: vi.fn().mockResolvedValue(personalSessions),
    },
    sessionEvents: {
      sumTokensByModelPerSession: vi.fn().mockResolvedValue(modelTotals),
    },
    installations: { coversRepository: vi.fn().mockResolvedValue(true) },
    resolveOrganizationId: async () => "org-1",
    isSourceNonBillable,
    now: () => NOW,
  });
  return { service, listByRepositoryBranch, findAllByBranches };
}

describe("PullRequestUsageService", () => {
  describe("given a pull request with sessions that have titles and transcripts", () => {
    /** @scenario "The usage response never carries content" */
    it("carries numbers, names and branch names only", async () => {
      const { service } = serviceWith({
        pullRequests: [pullRequestRow()],
        sessions: [sessionRow()],
      });

      const usage = await service.getPullRequestUsage(QUERY);

      // The response's own key set, pinned. A field added here without being
      // added to this list is a field nobody decided to disclose.
      expect(Object.keys(usage).sort()).toEqual([
        "modelBreakdown",
        "pullRequest",
        "rows",
        "totals",
      ]);
      expect(Object.keys(usage.pullRequest).sort()).toEqual([
        "authorLogin",
        "headBranch",
        "htmlUrl",
        "isDraft",
        "prClosedAtMs",
        "prCreatedAtMs",
        "prMergedAtMs",
        "prNumber",
        "repositoryFullName",
        "repositoryHost",
        "state",
      ]);
      expect(Object.keys(usage.rows[0]!).sort()).toEqual([
        "agent",
        "billedCostUsd",
        "cacheCreationTokens",
        "cacheReadTokens",
        "contributorIsProject",
        "contributorLabel",
        "costUsd",
        "inputTokens",
        "models",
        "nonBilledCostUsd",
        "outputTokens",
        "projectId",
        "projectSlug",
        "sessionsCount",
        "totalTokens",
      ]);
      expect(Object.keys(usage.totals).sort()).toEqual([
        "billedCostUsd",
        "cacheCreationTokens",
        "cacheReadTokens",
        "costUsd",
        "inputTokens",
        "nonBilledCostUsd",
        "outputTokens",
        "sessionsCount",
        "totalTokens",
      ]);
      // Not even the pull request's own GitHub title rides along, and no
      // session id leaks a handle onto the transcript.
      expect(JSON.stringify(usage)).not.toContain("Link sessions to pull");
      expect(JSON.stringify(usage)).not.toContain("session-a");
    });
  });

  // One person's agent can report a different id about itself from one session
  // to the next, and that id names nobody either way, so keying rows on it
  // showed one contributor twice with their work divided between the rows.
  describe("given one project whose sessions report two agent identities", () => {
    /** @scenario "One contributor and agent make one row, whatever the agent calls its user" */
    it("makes one row per project and agent, never one per reported identity", async () => {
      const { service } = serviceWith({
        pullRequests: [pullRequestRow()],
        sessions: [
          sessionRow({ sessionId: "s1", userId: "user-abc" }),
          sessionRow({ sessionId: "s2", userId: "user-abc" }),
          sessionRow({
            sessionId: "s3",
            userId: "user-xyz",
            models: ["gpt-5-mini"],
          }),
          sessionRow({ sessionId: "s4", userId: "user-xyz", agent: "codex" }),
        ],
      });

      const usage = await service.getPullRequestUsage(QUERY);

      expect(
        usage.rows.map((row) => [row.contributorLabel, row.agent]),
      ).toEqual([
        ["Riley Chase", "claude_code"],
        ["Riley Chase", "codex"],
      ]);
      expect(
        usage.rows.find((row) => row.agent === "claude_code")?.sessionsCount,
      ).toBe(3);
      expect(JSON.stringify(usage)).not.toContain("user-abc");
      expect(usage.totals.sessionsCount).toBe(4);
      expect(usage.totals.totalTokens).toBe(4 * 180);
      expect(usage.totals.costUsd).toBeCloseTo(6);
    });
  });

  describe("given a pull request worked on in a personal workspace and a shared project", () => {
    /** @scenario "A personal workspace is named by the person whose work it is" */
    it("names the personal workspace by its owner and never links it", async () => {
      const { service } = serviceWith({
        pullRequests: [pullRequestRow()],
        sessions: [sessionRow({ tenantId: "project-1" })],
      });

      const usage = await service.getPullRequestUsage(QUERY);

      expect(usage.rows[0]?.contributorLabel).toBe("Riley Chase");
      expect(usage.rows[0]?.contributorIsProject).toBe(false);
      expect(usage.rows[0]?.projectSlug).toBe("riley-personal");
    });

    /** @scenario "A shared project is named by the project the work ran in" */
    it("names a shared project by itself and offers its slug to link to", async () => {
      const { service } = serviceWith({
        pullRequests: [pullRequestRow()],
        sessions: [sessionRow({ tenantId: "project-2" })],
      });

      const usage = await service.getPullRequestUsage({
        ...QUERY,
        ...BOTH_PROJECTS,
      });

      expect(usage.rows[0]?.contributorLabel).toBe("Gateway");
      expect(usage.rows[0]?.contributorIsProject).toBe(true);
      expect(usage.rows[0]?.projectSlug).toBe("gateway");
    });
  });

  describe("given a session that ran after the pull request was merged", () => {
    it("leaves it out of the rollup", async () => {
      const { service } = serviceWith({
        pullRequests: [
          pullRequestRow({
            prClosedAt: new Date(NOW - 4 * HOUR),
            prMergedAt: new Date(NOW - 4 * HOUR),
          }),
        ],
        sessions: [
          sessionRow({ sessionId: "before", startedAtMs: NOW - 5 * HOUR }),
          sessionRow({ sessionId: "after", startedAtMs: NOW - HOUR }),
        ],
      });

      const usage = await service.getPullRequestUsage(QUERY);

      expect(usage.totals.sessionsCount).toBe(1);
    });
  });

  describe("given a caller who may view no project at all", () => {
    it("reads no sessions and answers with empty totals", async () => {
      const { service, listByRepositoryBranch } = serviceWith({
        pullRequests: [pullRequestRow()],
        sessions: [sessionRow()],
      });

      const usage = await service.getPullRequestUsage({
        ...QUERY,
        permittedProjectIds: [],
        costProjectIds: [],
      });

      expect(usage.rows).toEqual([]);
      expect(usage.totals.sessionsCount).toBe(0);
      expect(listByRepositoryBranch).not.toHaveBeenCalled();
    });
  });

  describe("given a project the caller may view but not price", () => {
    it("returns its tokens with no cost", async () => {
      const { service } = serviceWith({
        pullRequests: [pullRequestRow()],
        sessions: [sessionRow()],
      });

      const usage = await service.getPullRequestUsage({
        ...QUERY,
        costProjectIds: [],
      });

      expect(usage.rows[0]?.totalTokens).toBe(180);
      expect(usage.rows[0]?.costUsd).toBeNull();
      expect(usage.totals.costUsd).toBeNull();
    });
  });

  // A session stores whatever casing the git remote carries, and a host is
  // case insensitive, so `GitHub.com` and `github.com` are one repository. Fold
  // only the repository half of the group key and they become two: the reader
  // sees the repository twice with its usage split between the rows, and the
  // group whose host is not already lower case matches no mapping row, so
  // every one of its branches is reported as having no pull request.
  describe("given one repository whose sessions report the host with different casing", () => {
    /** @scenario "One repository reported with two host spellings stays one repository" */
    it("lists it once, with every session, under the mapping's own spelling", async () => {
      const { service, findAllByBranches } = personalServiceWith({
        pullRequests: [pullRequestRow()],
        findAllByBranches: findAllByBranchesLike([pullRequestRow()]),
        personalSessions: [
          personalSessionRow({ sessionId: "s1" }),
          personalSessionRow({
            sessionId: "s2",
            repositoryHost: "GitHub.com",
            repositoryOwner: "ACME",
            repositoryName: "Widgets",
          }),
        ],
        organizationSessions: [
          sessionRow({ sessionId: "s1" }),
          sessionRow({ sessionId: "s2" }),
        ],
      });

      const usage = await service.getForPersonalProject(PERSONAL_QUERY);

      expect(findAllByBranches).toHaveBeenCalledTimes(1);
      expect(findAllByBranches).toHaveBeenCalledWith(
        expect.objectContaining({
          repositoryHost: "github.com",
          repositoryFullName: "acme/widgets",
        }),
      );
      expect(usage.rows).toHaveLength(1);
      expect(usage.rows[0]?.sessionsCount).toBe(2);
      expect(usage.rows[0]?.costUsd).toBeCloseTo(3.0);
      expect(usage.unlinked).toEqual([]);
    });
  });

  describe("its session read", () => {
    it("bounds the partition scan on the session start time", async () => {
      const { service, listByRepositoryBranch } = serviceWith({
        pullRequests: [pullRequestRow()],
        sessions: [sessionRow()],
      });

      await service.getPullRequestUsage(QUERY);

      expect(listByRepositoryBranch).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantIds: ["project-1"],
          repositoryOwner: "acme",
          repositoryName: "widgets",
          branches: ["feat/linkage"],
          startedAtFromMs: expect.any(Number),
        }),
      );
      const call = listByRepositoryBranch.mock.calls[0]![0] as {
        startedAtFromMs: number;
      };
      expect(call.startedAtFromMs).toBeLessThan(NOW);
    });
  });

  // The app layer publishes this service through `traced()`, a Proxy that
  // returns every function it is asked for wrapped in a span, so anything the
  // service reaches for as `this.<something>()` comes back as a Promise. A
  // clock read that way yields NaN once it meets arithmetic, and NaN reaches
  // ClickHouse as a query parameter, which fails the read outright. These run
  // through the same Proxy the app does rather than the bare instance.
  describe("when published through the tracing proxy", () => {
    it("still bounds the personal read on a real timestamp", async () => {
      const listRecent = vi.fn().mockResolvedValue([]);
      const service = traced(
        new PullRequestUsageService({
          pullRequests: {
            findByNumber: vi.fn(),
            findAllByBranches: vi.fn().mockResolvedValue([]),
          } as never,
          sessions: { listByRepositoryBranch: vi.fn() } as never,
          personalSessions: { listRecent },
          sessionEvents: {
            sumTokensByModelPerSession: vi.fn().mockResolvedValue([]),
          },
          installations: { coversRepository: vi.fn().mockResolvedValue(true) },
          resolveOrganizationId: async () => "org-1",
          isSourceNonBillable: allBilled,
        }),
        "PullRequestUsageService",
      );

      await service.getForPersonalProject(PERSONAL_QUERY);

      const call = listRecent.mock.calls[0]![0] as {
        fromMs: number;
        toMs: number;
      };
      expect(Number.isFinite(call.fromMs)).toBe(true);
      expect(Number.isFinite(call.toMs)).toBe(true);
      expect(call.fromMs).toBeLessThan(call.toMs);
    });

    it("still bounds the pull request read on a real timestamp", async () => {
      const listByRepositoryBranch = vi.fn().mockResolvedValue([]);
      const service = traced(
        new PullRequestUsageService({
          pullRequests: {
            findByNumber: vi.fn().mockResolvedValue(pullRequestRow()),
            findAllByBranches: vi.fn().mockResolvedValue([pullRequestRow()]),
          } as never,
          sessions: { listByRepositoryBranch } as never,
          personalSessions: { listRecent: vi.fn().mockResolvedValue([]) },
          sessionEvents: {
            sumTokensByModelPerSession: vi.fn().mockResolvedValue([]),
          },
          installations: { coversRepository: vi.fn().mockResolvedValue(true) },
          resolveOrganizationId: async () => "org-1",
          isSourceNonBillable: allBilled,
        }),
        "PullRequestUsageService",
      );

      await service.getPullRequestUsage(QUERY);

      const call = listByRepositoryBranch.mock.calls[0]![0] as {
        startedAtFromMs: number;
      };
      expect(Number.isFinite(call.startedAtFromMs)).toBe(true);
    });
  });

  describe("given a pull request whose sessions logged no per-call model data", () => {
    /** @scenario "A pull request reports its models even without per-call data" */
    it("reports the models its sessions recorded", async () => {
      const { service } = personalServiceWith({
        pullRequests: [pullRequestRow()],
        personalSessions: [personalSessionRow({ sessionId: "mine" })],
        organizationSessions: [
          sessionRow({ sessionId: "mine", models: ["claude-opus-5"] }),
          sessionRow({
            sessionId: "theirs",
            models: ["claude-opus-5", "gpt-5"],
          }),
        ],
        // The per-call table is fed by a carrier these sessions never used.
        modelTotals: [],
      });

      const usage = await service.getForPersonalProject(PERSONAL_QUERY);

      expect(
        usage.rows[0]?.modelBreakdown.map((each) => ({
          model: each.model,
          tokensKnown: each.tokensKnown,
        })),
      ).toEqual([
        { model: "claude-opus-5", tokensKnown: false },
        { model: "gpt-5", tokensKnown: false },
      ]);
    });

    /** @scenario "Per-call model data wins over the recorded names" */
    it("still reports the per-call breakdown when there is one", async () => {
      const { service } = personalServiceWith({
        pullRequests: [pullRequestRow()],
        personalSessions: [personalSessionRow({ sessionId: "mine" })],
        organizationSessions: [
          sessionRow({ sessionId: "mine", models: ["claude-opus-5"] }),
        ],
        modelTotals: [
          modelTotalsRow({ sessionId: "mine", model: "claude-opus-5" }),
        ],
      });

      const usage = await service.getForPersonalProject(PERSONAL_QUERY);

      expect(usage.rows[0]?.modelBreakdown).toEqual([
        expect.objectContaining({ model: "claude-opus-5", tokensKnown: true }),
      ]);
    });
  });

  describe("given a branch with no pull request whose sessions ran a model", () => {
    /** @scenario "A branch rollup carries the models its sessions ran" */
    it("reports them on the branch rollup", async () => {
      const { service } = personalServiceWith({
        pullRequests: [],
        personalSessions: [
          personalSessionRow({ sessionId: "mine", models: ["claude-opus-5"] }),
          personalSessionRow({
            sessionId: "mine-2",
            models: ["claude-opus-5", "claude-haiku-4-5"],
          }),
        ],
      });

      const usage = await service.getForPersonalProject(PERSONAL_QUERY);

      expect(
        usage.unlinked[0]?.modelBreakdown.map((each) => each.model),
      ).toEqual(["claude-haiku-4-5", "claude-opus-5"]);
    });

    /** @scenario "A branch whose sessions recorded no model reports none" */
    it("reports no models when its sessions recorded none", async () => {
      const { service } = personalServiceWith({
        pullRequests: [],
        personalSessions: [
          personalSessionRow({ sessionId: "mine", models: [] }),
        ],
      });

      const usage = await service.getForPersonalProject(PERSONAL_QUERY);

      expect(usage.unlinked[0]?.modelBreakdown).toEqual([]);
    });
  });

  describe("given a pull request whose sessions ran in two projects", () => {
    /** @scenario "A listed pull request counts every project the viewer may read" */
    it("counts every project the viewer may read on the personal row", async () => {
      const { service, listByRepositoryBranch } = personalServiceWith({
        pullRequests: [pullRequestRow()],
        personalSessions: [personalSessionRow({ sessionId: "mine" })],
        organizationSessions: [
          sessionRow({ sessionId: "mine", tenantId: "project-1" }),
          sessionRow({ sessionId: "theirs", tenantId: "project-2" }),
        ],
      });

      const usage = await service.getForPersonalProject({
        ...PERSONAL_QUERY,
        ...BOTH_PROJECTS,
      });

      expect(listByRepositoryBranch).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantIds: ["project-1", "project-2"],
        }),
      );
      expect(usage.rows[0]?.sessionsCount).toBe(2);
      expect(usage.rows[0]?.totalTokens).toBe(2 * 180);
      expect(usage.rows[0]?.costUsd).toBeCloseTo(3.0);
    });

    /** @scenario "A project the viewer may not read is absent from the row and its totals" */
    it("leaves a project the viewer may not read out of the row and its totals", async () => {
      const { service, listByRepositoryBranch } = personalServiceWith({
        pullRequests: [pullRequestRow()],
        personalSessions: [personalSessionRow({ sessionId: "mine" })],
        // The read is scoped to the permitted projects, so a hidden project's
        // sessions never come back at all.
        organizationSessions: [
          sessionRow({ sessionId: "mine", tenantId: "project-1" }),
        ],
      });

      const usage = await service.getForPersonalProject(PERSONAL_QUERY);

      expect(listByRepositoryBranch).toHaveBeenCalledWith(
        expect.objectContaining({ tenantIds: ["project-1"] }),
      );
      expect(usage.rows[0]?.sessionsCount).toBe(1);
      expect(usage.rows[0]?.costUsd).toBeCloseTo(1.5);
    });

    /** @scenario "A row names who worked on the pull request" */
    it("names each contributor once and how many sessions they ran", async () => {
      const { service } = personalServiceWith({
        pullRequests: [pullRequestRow()],
        personalSessions: [personalSessionRow({ sessionId: "mine" })],
        organizationSessions: [
          sessionRow({
            sessionId: "s1",
            tenantId: "project-1",
            userId: "riley",
          }),
          // The same person on a second agent, which the summary counts under
          // the one name rather than listing them twice.
          sessionRow({
            sessionId: "s2",
            tenantId: "project-1",
            userId: "riley-2",
            agent: "codex",
          }),
          sessionRow({
            sessionId: "s3",
            tenantId: "project-2",
            userId: "reviewer",
          }),
        ],
      });

      const usage = await service.getForPersonalProject({
        ...PERSONAL_QUERY,
        ...BOTH_PROJECTS,
      });

      expect(usage.rows[0]?.contributorsSummary).toEqual([
        {
          contributorLabel: "Riley Chase",
          projectId: "project-1",
          projectSlug: "riley-personal",
          contributorIsProject: false,
          sessionsCount: 2,
        },
        {
          contributorLabel: "Gateway",
          projectId: "project-2",
          projectSlug: "gateway",
          contributorIsProject: true,
          sessionsCount: 1,
        },
      ]);
    });
  });

  describe("given a branch with no pull request", () => {
    /** @scenario "Branches with no pull request stay the viewer's own work" */
    it("reports only the viewer's own sessions", async () => {
      const { service } = personalServiceWith({
        pullRequests: [],
        personalSessions: [
          personalSessionRow({ sessionId: "mine", gitBranch: "feat/orphan" }),
        ],
        // Would be counted if the branch rollup went organization-wide.
        organizationSessions: [
          sessionRow({ sessionId: "theirs", tenantId: "project-2" }),
        ],
      });

      const usage = await service.getForPersonalProject({
        ...PERSONAL_QUERY,
        ...BOTH_PROJECTS,
      });

      expect(usage.unlinked).toHaveLength(1);
      expect(usage.unlinked[0]?.sessionsCount).toBe(1);
      expect(usage.unlinked[0]?.costUsd).toBeCloseTo(1.5);
    });
  });

  // "Last update" is the page's own answer rather than GitHub's: when the work
  // this row prices last ran. It follows the same split as the numbers beside
  // it, organization-wide for a pull request and personal for a branch.
  describe("given a pull request whose sessions ran at different times", () => {
    /** @scenario "A pull request's last update is the latest session across every counted project" */
    it("takes the last update from the most recent session in any counted project", async () => {
      const { service } = personalServiceWith({
        pullRequests: [pullRequestRow()],
        personalSessions: [personalSessionRow({ sessionId: "mine" })],
        organizationSessions: [
          sessionRow({
            sessionId: "mine",
            tenantId: "project-1",
            startedAtMs: NOW - 5 * HOUR,
          }),
          sessionRow({
            sessionId: "theirs",
            tenantId: "project-2",
            startedAtMs: NOW - HOUR,
          }),
        ],
      });

      const usage = await service.getForPersonalProject({
        ...PERSONAL_QUERY,
        ...BOTH_PROJECTS,
      });

      expect(usage.rows[0]?.lastActivityAtMs).toBe(NOW - HOUR);
    });

    /** @scenario "A pull request's last update is the latest session across every counted project" */
    it("counts a long session by when it last ran rather than when it started", async () => {
      const { service } = personalServiceWith({
        pullRequests: [pullRequestRow()],
        personalSessions: [personalSessionRow({ sessionId: "long" })],
        organizationSessions: [
          sessionRow({
            sessionId: "long",
            startedAtMs: NOW - 6 * HOUR,
            lastEventOccurredAtMs: NOW - HOUR / 2,
          }),
          sessionRow({ sessionId: "short", startedAtMs: NOW - 2 * HOUR }),
        ],
      });

      const usage = await service.getForPersonalProject(PERSONAL_QUERY);

      expect(usage.rows[0]?.lastActivityAtMs).toBe(NOW - HOUR / 2);
    });
  });

  describe("given a branch with no pull request whose sessions ran at different times", () => {
    /** @scenario "A branch's last update is the latest of its own sessions" */
    it("takes the last update from the viewer's own most recent session on it", async () => {
      const { service } = personalServiceWith({
        pullRequests: [],
        personalSessions: [
          personalSessionRow({
            sessionId: "older",
            gitBranch: "feat/orphan",
            startedAtMs: NOW - 8 * HOUR,
          }),
          personalSessionRow({
            sessionId: "newer",
            gitBranch: "feat/orphan",
            startedAtMs: NOW - 2 * HOUR,
          }),
        ],
        // A teammate working more recently in a project the viewer may read:
        // the branch rollup is personal, so it must not move the answer.
        organizationSessions: [
          sessionRow({
            sessionId: "theirs",
            tenantId: "project-2",
            gitBranch: "feat/orphan",
            startedAtMs: NOW - HOUR,
          }),
        ],
      });

      const usage = await service.getForPersonalProject({
        ...PERSONAL_QUERY,
        ...BOTH_PROJECTS,
      });

      expect(usage.unlinked).toHaveLength(1);
      expect(usage.unlinked[0]?.lastActivityAtMs).toBe(NOW - 2 * HOUR);
    });
  });

  describe("when the read resolves which projects to count", () => {
    /** @scenario "The viewer never chooses which projects are counted" */
    it("counts the projects it was handed and never a repository name from the request", async () => {
      const { service, listByRepositoryBranch } = serviceWith({
        pullRequests: [pullRequestRow()],
        sessions: [sessionRow()],
      });

      await service.getPullRequestUsage({
        ...QUERY,
        permittedProjectIds: ["project-1"],
        costProjectIds: [],
      });

      // The query object carries no project list of its own: `tenantIds` is
      // exactly the resolved permission cut, so a caller cannot widen it.
      const call = listByRepositoryBranch.mock.calls[0]![0] as {
        tenantIds: string[];
      };
      expect(call.tenantIds).toEqual(["project-1"]);
    });
  });

  describe("given an assistant covered by a bundled plan", () => {
    /** @scenario "A bundled assistant's cost is reported as not billed" */
    it("reports the whole cost as not billed and still totals the list price", async () => {
      const { service } = serviceWith({
        pullRequests: [pullRequestRow()],
        sessions: [sessionRow()],
        isSourceNonBillable: async () => true,
      });

      const usage = await service.getPullRequestUsage(QUERY);

      expect(usage.totals.nonBilledCostUsd).toBeCloseTo(1.5);
      expect(usage.totals.billedCostUsd).toBe(0);
      expect(usage.totals.costUsd).toBeCloseTo(1.5);
    });

    /** @scenario "An assistant billed per token reports its cost as billed" */
    it("reports a per-token assistant's cost as billed", async () => {
      const { service } = serviceWith({
        pullRequests: [pullRequestRow()],
        sessions: [sessionRow()],
      });

      const usage = await service.getPullRequestUsage(QUERY);

      expect(usage.totals.billedCostUsd).toBeCloseTo(1.5);
      expect(usage.totals.nonBilledCostUsd).toBe(0);
    });

    /** @scenario "Two assistants on one pull request split its cost between them" */
    it("splits the cost between a bundled assistant and a per-token one", async () => {
      const { service } = serviceWith({
        pullRequests: [pullRequestRow()],
        sessions: [
          sessionRow({ sessionId: "s1", agent: "claude_code", costUsd: 2 }),
          sessionRow({ sessionId: "s2", agent: "gemini_cli", costUsd: 3 }),
        ],
        isSourceNonBillable: async ({ sourceType }) => sourceType === "gemini",
      });

      const usage = await service.getPullRequestUsage(QUERY);

      expect(usage.totals.billedCostUsd).toBeCloseTo(2);
      expect(usage.totals.nonBilledCostUsd).toBeCloseTo(3);
      expect(usage.totals.costUsd).toBeCloseTo(5);
    });

    /** @scenario "A viewer who may not price a project sees neither half of its cost" */
    it("leaves every half of the cost absent for a project the viewer may not price", async () => {
      const { service } = serviceWith({
        pullRequests: [pullRequestRow()],
        sessions: [sessionRow()],
        isSourceNonBillable: async () => true,
      });

      const usage = await service.getPullRequestUsage({
        ...QUERY,
        costProjectIds: [],
      });

      expect(usage.rows[0]?.costUsd).toBeNull();
      expect(usage.rows[0]?.billedCostUsd).toBeNull();
      expect(usage.rows[0]?.nonBilledCostUsd).toBeNull();
      expect(usage.totals.billedCostUsd).toBeNull();
      expect(usage.totals.nonBilledCostUsd).toBeNull();
    });
  });

  describe("given a pull request whose sessions called two models", () => {
    /** @scenario "The row reports each model's tokens and cost" */
    it("reports each model's own tokens and cost", async () => {
      const { service, sumTokensByModelPerSession } = serviceWith({
        pullRequests: [pullRequestRow()],
        sessions: [sessionRow({ sessionId: "s1" })],
        modelTotals: [
          modelTotalsRow({ sessionId: "s1", model: "claude-fable-5" }),
          modelTotalsRow({
            sessionId: "s1",
            model: "gpt-5-mini",
            inputTokens: 1,
            outputTokens: 1,
            cacheReadTokens: 1,
            cacheCreationTokens: 1,
            costUsd: 0.25,
          }),
          // Another pull request's session: never counted here.
          modelTotalsRow({ sessionId: "elsewhere", model: "claude-fable-5" }),
        ],
      });

      const usage = await service.getPullRequestUsage(QUERY);

      expect(sumTokensByModelPerSession).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantIds: ["project-1"],
          sessionIds: ["s1"],
          fromMs: expect.any(Number),
        }),
      );
      expect(usage.modelBreakdown).toEqual([
        {
          model: "claude-fable-5",
          inputTokens: 100,
          outputTokens: 50,
          cacheReadTokens: 20,
          cacheCreationTokens: 10,
          totalTokens: 180,
          costUsd: 1.5,
          tokensKnown: true,
        },
        {
          model: "gpt-5-mini",
          inputTokens: 1,
          outputTokens: 1,
          cacheReadTokens: 1,
          cacheCreationTokens: 1,
          totalTokens: 4,
          costUsd: 0.25,
          tokensKnown: true,
        },
      ]);
    });

    /** @scenario "A model's cost is absent when no permitted project may be priced" */
    it("reports a model's tokens with no cost when nothing may be priced", async () => {
      const { service } = serviceWith({
        pullRequests: [pullRequestRow()],
        sessions: [sessionRow({ sessionId: "s1" })],
        modelTotals: [modelTotalsRow({ sessionId: "s1" })],
      });

      const usage = await service.getPullRequestUsage({
        ...QUERY,
        costProjectIds: [],
      });

      expect(usage.modelBreakdown[0]?.totalTokens).toBe(180);
      expect(usage.modelBreakdown[0]?.costUsd).toBeNull();
    });
  });

  describe("when the pull request detail is read", () => {
    /** @scenario "The detail carries its contributors, models and sessions" */
    it("carries the totals, the contributors, the models and the sessions newest first", async () => {
      const { service } = serviceWith({
        pullRequests: [pullRequestRow()],
        sessions: [
          sessionRow({ sessionId: "older", startedAtMs: NOW - 8 * HOUR }),
          sessionRow({ sessionId: "newer", startedAtMs: NOW - 2 * HOUR }),
        ],
        modelTotals: [modelTotalsRow({ sessionId: "newer" })],
      });

      const detail = await service.getPullRequestDetail(QUERY);

      expect(detail.pullRequest.title).toBe("Link sessions to pull requests");
      expect(detail.totals.sessionsCount).toBe(2);
      expect(detail.contributors[0]?.contributorLabel).toBe("Riley Chase");
      expect(detail.modelBreakdown[0]?.model).toBe("claude-fable-5");
      expect(detail.sessions.map((session) => session.sessionId)).toEqual([
        "newer",
        "older",
      ]);
    });

    /** @scenario "The sessions list never carries a session title" */
    it("carries facts about each session and nothing else", async () => {
      const { service } = serviceWith({
        pullRequests: [pullRequestRow()],
        sessions: [sessionRow()],
      });

      const detail = await service.getPullRequestDetail(QUERY);

      // The session row's own key set, pinned. A title added here would be a
      // disclosure nobody decided on.
      expect(Object.keys(detail.sessions[0]!).sort()).toEqual([
        "agent",
        "contributorIsProject",
        "contributorLabel",
        "costUsd",
        "projectId",
        "projectSlug",
        "sessionId",
        "startedAtMs",
        "totalTokens",
      ]);
    });
  });
});
