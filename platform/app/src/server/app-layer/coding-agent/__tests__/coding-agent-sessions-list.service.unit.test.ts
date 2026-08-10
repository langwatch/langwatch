/**
 * @vitest-environment node
 * @unit
 *
 * The Sessions screen's list: what a row carries, how far back it looks, and
 * how one page of sessions finds every pull request it drove in one lookup.
 *
 * @see specs/coding-agent/sessions-screen.feature
 * @see specs/coding-agent/session-git-context.feature
 */
import { describe, expect, it, vi } from "vitest";
import type { CodingAgentSessionRow } from "~/server/event-sourcing/pipelines/coding-agent-processing/projections/codingAgentSession.foldProjection";
import { codingAgentSessionRow } from "../../github/__tests__/codingAgentSessionRowFixture";
import type { GithubPullRequestLookup } from "../../traces/session-groups.pull-request-link";
import {
  branchesOf,
  CodingAgentSessionsListService,
  SESSIONS_LIST_LIMIT,
  SESSIONS_LIST_WINDOW_MS,
} from "../coding-agent-sessions-list.service";

const HOUR = 60 * 60 * 1000;
const NOW = Date.UTC(2026, 7, 10);
const PROJECT = "project-1";

type PullRequestCandidate = Awaited<
  ReturnType<GithubPullRequestLookup["findForBranches"]>
>[number];

function sessionRow(
  over: Partial<CodingAgentSessionRow> = {},
): CodingAgentSessionRow {
  return codingAgentSessionRow({
    tenantId: PROJECT,
    sessionId: "session-a",
    startedAtMs: NOW - 5 * HOUR,
    lastEventOccurredAt: NOW - 4 * HOUR,
    repositoryHost: "github.com",
    repositoryOwner: "acme",
    repositoryName: "widgets",
    gitBranch: "feat/two",
    gitBranches: ["feat/one", "feat/two"],
    title: "Add the sessions screen",
    ...over,
  });
}

function pullRequest(over: Partial<PullRequestCandidate> = {}) {
  return {
    repositoryHost: "github.com",
    repositoryFullName: "acme/widgets",
    headBranch: "feat/one",
    prNumber: 11,
    htmlUrl: "https://github.com/acme/widgets/pull/11",
    title: "Remember every branch",
    prCreatedAt: new Date(NOW - 20 * HOUR),
    prClosedAt: null,
    prMergedAt: null,
    ...over,
  };
}

function serviceWith({
  rows,
  pullRequests = [],
  organizationId = "org-1",
}: {
  rows: CodingAgentSessionRow[];
  pullRequests?: PullRequestCandidate[];
  /** Null stands for a project whose organization cannot be resolved. */
  organizationId?: string | null;
}) {
  const listRecent = vi.fn().mockResolvedValue(rows);
  const findForBranches = vi.fn().mockResolvedValue(pullRequests);
  const service = new CodingAgentSessionsListService({
    sessions: { listRecent },
    pullRequests: { findForBranches },
    resolveOrganizationId: async () => organizationId ?? undefined,
    now: () => NOW,
  });
  return { service, listRecent, findForBranches };
}

describe("CodingAgentSessionsListService", () => {
  describe("given a personal workspace with coding-agent sessions", () => {
    /** @scenario "The list answers with the sessions of the last ninety days" */
    it("asks for the trailing ninety days, one page at most", async () => {
      const { service, listRecent } = serviceWith({ rows: [sessionRow()] });

      await service.listForProject({ projectId: PROJECT });

      expect(listRecent).toHaveBeenCalledTimes(1);
      expect(listRecent).toHaveBeenCalledWith({
        projectId: PROJECT,
        fromMs: NOW - SESSIONS_LIST_WINDOW_MS,
        toMs: NOW,
        limit: SESSIONS_LIST_LIMIT,
      });
      expect(SESSIONS_LIST_WINDOW_MS).toBe(90 * 24 * HOUR);
    });

    /** @scenario "A row carries what a session cost in context, not only in tokens" */
    it("carries the context economics, the time split and the totals", async () => {
      const { service } = serviceWith({
        rows: [
          sessionRow({
            peakContextTokens: 180_000,
            compactions: 2,
            compactionTokensBefore: 170_000,
            compactionTokensAfter: 40_000,
            cacheRebuildCount: 3,
            largestCacheRebuildTokens: 90_000,
            activeTimeCliSec: 1_800,
            blockedOnUserMs: 600_000,
            inputTokens: 1_000,
            outputTokens: 2_000,
            cacheReadTokens: 3_000,
            cacheCreationTokens: 4_000,
            costUsd: 12.5,
            models: ["claude-fable-5"],
            agentVersion: "2.0.0",
          }),
        ],
      });

      const [row] = await service.listForProject({ projectId: PROJECT });

      expect(row).toMatchObject({
        sessionId: "session-a",
        agent: "claude_code",
        agentVersion: "2.0.0",
        repositoryHost: "github.com",
        repositoryOwner: "acme",
        repositoryName: "widgets",
        gitBranch: "feat/two",
        gitBranches: ["feat/one", "feat/two"],
        startedAtMs: NOW - 5 * HOUR,
        lastEventOccurredAtMs: NOW - 4 * HOUR,
        peakContextTokens: 180_000,
        compactions: 2,
        compactionTokensBefore: 170_000,
        compactionTokensAfter: 40_000,
        cacheRebuildCount: 3,
        largestCacheRebuildTokens: 90_000,
        activeTimeCliSec: 1_800,
        blockedOnUserMs: 600_000,
        inputTokens: 1_000,
        outputTokens: 2_000,
        cacheReadTokens: 3_000,
        cacheCreationTokens: 4_000,
        costUsd: 12.5,
        models: ["claude-fable-5"],
      });
    });

    /** @scenario "A row is named by the title the session generated" */
    it("names a row by its title, and says so when there is none", async () => {
      const { service } = serviceWith({
        rows: [sessionRow(), sessionRow({ sessionId: "session-b", title: "" })],
      });

      const rows = await service.listForProject({ projectId: PROJECT });

      expect(rows[0]?.title).toBe("Add the sessions screen");
      // Nothing to show reads as nothing, never as an empty string, so the
      // page renders its own words for an untitled session.
      expect(rows[1]?.title).toBeNull();
    });
  });

  describe("when a session drove more than one branch", () => {
    /** @scenario "A session that worked on two branches lists both of their pull requests" */
    it("lists a pull request per branch, by number ascending", async () => {
      const { service } = serviceWith({
        rows: [sessionRow()],
        pullRequests: [
          pullRequest({ headBranch: "feat/two", prNumber: 42 }),
          pullRequest({ headBranch: "feat/one", prNumber: 11 }),
        ],
      });

      const [row] = await service.listForProject({ projectId: PROJECT });

      expect(row?.pullRequests).toEqual([
        {
          number: 11,
          url: "https://github.com/acme/widgets/pull/11",
          title: "Remember every branch",
        },
        {
          number: 42,
          url: "https://github.com/acme/widgets/pull/11",
          title: "Remember every branch",
        },
      ]);
    });

    /** @scenario "The pull requests of a whole page are looked up in one call" */
    it("looks the whole page up once, on its distinct branch keys", async () => {
      const { service, findForBranches } = serviceWith({
        rows: [
          sessionRow(),
          sessionRow({ sessionId: "session-b" }),
          sessionRow({
            sessionId: "session-c",
            repositoryName: "gadgets",
            gitBranch: "fix/crash",
            gitBranches: ["fix/crash"],
          }),
        ],
      });

      await service.listForProject({ projectId: PROJECT });

      expect(findForBranches).toHaveBeenCalledTimes(1);
      const { keys } = findForBranches.mock.calls[0]![0];
      // Two sessions sharing a repository and branches ask once for each, and
      // the third repository joins the same call.
      expect(keys).toEqual([
        {
          repositoryHost: "github.com",
          repositoryFullName: "acme/widgets",
          headBranch: "feat/one",
        },
        {
          repositoryHost: "github.com",
          repositoryFullName: "acme/widgets",
          headBranch: "feat/two",
        },
        {
          repositoryHost: "github.com",
          repositoryFullName: "acme/gadgets",
          headBranch: "fix/crash",
        },
      ]);
    });

    // A branch that hosted a merged pull request and later another one is the
    // reason the tenure rule exists: a session belongs to the era it ran in,
    // never to every pull request the branch ever had.
    it("takes the pull request whose era the session ran in", async () => {
      const { service } = serviceWith({
        rows: [
          sessionRow({
            gitBranch: "feat/one",
            gitBranches: ["feat/one"],
            startedAtMs: NOW - 2 * HOUR,
          }),
        ],
        pullRequests: [
          pullRequest({
            prNumber: 5,
            prCreatedAt: new Date(NOW - 40 * HOUR),
            prClosedAt: new Date(NOW - 30 * HOUR),
            prMergedAt: new Date(NOW - 30 * HOUR),
          }),
          pullRequest({ prNumber: 9, prCreatedAt: new Date(NOW - 3 * HOUR) }),
        ],
      });

      const [row] = await service.listForProject({ projectId: PROJECT });

      expect(row?.pullRequests.map((pull) => pull.number)).toEqual([9]);
    });

    /** @scenario "A session recorded before branches were remembered falls back to its last branch" */
    it("finds the pull requests of a row that has only its last branch", async () => {
      const { service, findForBranches } = serviceWith({
        rows: [sessionRow({ gitBranches: [], gitBranch: "feat/one" })],
        pullRequests: [pullRequest()],
      });

      const [row] = await service.listForProject({ projectId: PROJECT });

      expect(findForBranches.mock.calls[0]![0].keys).toEqual([
        {
          repositoryHost: "github.com",
          repositoryFullName: "acme/widgets",
          headBranch: "feat/one",
        },
      ]);
      expect(row?.pullRequests.map((pull) => pull.number)).toEqual([11]);
      // The row answers with the one branch it does know about, so the page
      // never shows a session as having driven nothing.
      expect(row?.gitBranches).toEqual(["feat/one"]);
    });
  });

  describe("when the join cannot answer", () => {
    /** @scenario "A workspace whose organization has no GitHub connection still lists its sessions" */
    it("lists every session with no pull requests", async () => {
      const { service, findForBranches } = serviceWith({
        rows: [sessionRow()],
        organizationId: null,
      });

      const rows = await service.listForProject({ projectId: PROJECT });

      expect(rows).toHaveLength(1);
      expect(rows[0]?.pullRequests).toEqual([]);
      expect(findForBranches).not.toHaveBeenCalled();
    });

    it("lists the sessions anyway when the lookup fails", async () => {
      const listRecent = vi.fn().mockResolvedValue([sessionRow()]);
      const service = new CodingAgentSessionsListService({
        sessions: { listRecent },
        pullRequests: {
          findForBranches: async () => {
            throw new Error("mapping unavailable");
          },
        },
        resolveOrganizationId: async () => "org-1",
        now: () => NOW,
      });

      const rows = await service.listForProject({ projectId: PROJECT });

      expect(rows).toHaveLength(1);
      expect(rows[0]?.pullRequests).toEqual([]);
    });

    it("asks nothing when no session names a repository", async () => {
      const { service, findForBranches } = serviceWith({
        rows: [
          sessionRow({
            repositoryOwner: "",
            repositoryName: "",
            gitBranch: "",
            gitBranches: [],
          }),
        ],
      });

      const rows = await service.listForProject({ projectId: PROJECT });

      expect(rows[0]?.pullRequests).toEqual([]);
      expect(findForBranches).not.toHaveBeenCalled();
    });
  });

  describe("given a session row written before the branch set column existed", () => {
    /** @scenario "A session row from before the branch set column falls back to its one branch" */
    it("answers with the branch the session ended on", () => {
      expect(branchesOf({ gitBranch: "feat/one", gitBranches: [] })).toEqual([
        "feat/one",
      ]);
      // A row that names no branch at all drove none, and says so.
      expect(branchesOf({ gitBranch: "", gitBranches: [] })).toEqual([]);
    });
  });
});
