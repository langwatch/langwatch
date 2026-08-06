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
import { traced } from "../../tracing";
import type { GithubPullRequestRow } from "../../github/repositories/github-pull-requests.repository";
import { PullRequestUsageService } from "../pull-request-usage.service";
import type { CodingAgentBranchSessionRow } from "../repositories/coding-agent-session.repository";

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

function serviceWith({
  pullRequests,
  sessions,
}: {
  pullRequests: GithubPullRequestRow[];
  sessions: CodingAgentBranchSessionRow[];
}) {
  const listByRepositoryBranch = vi.fn().mockResolvedValue(sessions);
  const service = new PullRequestUsageService({
    pullRequests: {
      findByNumber: vi.fn().mockResolvedValue(pullRequests[0] ?? null),
      findAllByBranches: vi.fn().mockResolvedValue(pullRequests),
    } as never,
    sessions: { listByRepositoryBranch } as never,
    personalSessions: { listRecent: vi.fn().mockResolvedValue([]) },
    installations: { coversRepository: vi.fn().mockResolvedValue(true) },
    resolveOrganizationId: async () => "org-1",
    now: () => NOW,
  });
  return { service, listByRepositoryBranch };
}

const QUERY = {
  organizationId: "org-1",
  repositoryHost: "github.com",
  repositoryFullName: "acme/widgets",
  prNumber: 7,
  permittedProjectIds: ["project-1"],
  costProjectIds: ["project-1"],
};

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
        "cacheCreationTokens",
        "cacheReadTokens",
        "costUsd",
        "inputTokens",
        "models",
        "outputTokens",
        "projectId",
        "sessionsCount",
        "totalTokens",
        "userLabel",
      ]);
      expect(Object.keys(usage.totals).sort()).toEqual([
        "cacheCreationTokens",
        "cacheReadTokens",
        "costUsd",
        "inputTokens",
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

  describe("given sessions from two users on one pull request", () => {
    it("groups them by project, reported user and agent", async () => {
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
        ],
      });

      const usage = await service.getPullRequestUsage(QUERY);

      expect(usage.rows).toHaveLength(2);
      expect(
        usage.rows.find((row) => row.userLabel === "user-abc")?.sessionsCount,
      ).toBe(2);
      expect(usage.totals.sessionsCount).toBe(3);
      expect(usage.totals.totalTokens).toBe(3 * 180);
      expect(usage.totals.costUsd).toBeCloseTo(4.5);
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
          installations: { coversRepository: vi.fn().mockResolvedValue(true) },
          resolveOrganizationId: async () => "org-1",
        }),
        "PullRequestUsageService",
      );

      await service.getForPersonalProject({ projectId: "project-1" });

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
          installations: { coversRepository: vi.fn().mockResolvedValue(true) },
          resolveOrganizationId: async () => "org-1",
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
});
