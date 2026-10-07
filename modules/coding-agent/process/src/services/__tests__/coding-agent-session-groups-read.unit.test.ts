/**
 * @vitest-environment node
 * The Sessions lens page coding-agent serves: trace reads it for the viewer, this enriches it.
 * @see modules/trace/specs/sessions-lens.feature
 * @see modules/coding-agent/specs/coding-agent-trace-reads.feature
 */
import type {
  CodingAgentSession,
  CodingAgentTracePullRequestLink,
} from "@langwatch/coding-agent-contract";
import { codingAgentSessionFixture } from "@langwatch/coding-agent-contract/testing";
import {
  teaserOf,
  type Protections,
  type TraceApi,
  type TracesSessionsPage,
} from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import {
  CodingAgentSessionGroupsReadService,
  type CodingAgentSessionGroupsSessions,
} from "../coding-agent-session-groups-read.service.ts";

type PageRow = TracesSessionsPage["sessions"][number];

const PROJECT_ID = "project-1";
const VIEWER = "viewer-1";
const FULL_VIEW: Protections = { canSeeCapturedInput: true, canSeeCapturedOutput: true };

function pageRow(overrides: Partial<PageRow> = {}): PageRow {
  return {
    conversationId: "session-a",
    traceCount: 3,
    totalCost: 1.25,
    totalTokens: 4200,
    cacheReadTokens: 90_000,
    cacheCreationTokens: 1200,
    contextSizeTokens: 52_000,
    totalDurationMs: 63_000,
    startedAtMs: 1_700_000_000_000,
    lastActivityMs: 1_700_000_600_000,
    models: ["claude-sonnet-4"],
    primaryModel: "claude-sonnet-4",
    serviceName: "cli",
    errorCount: 0,
    warningCount: 0,
    totalSpans: 12,
    lastTraceId: "trace-latest",
    input: "fix the flaky test",
    output: "done, pushed",
    inputRedacted: false,
    outputRedacted: false,
    inputVisibleTo: null,
    outputVisibleTo: null,
    codingAgent: null,
    ...overrides,
  };
}

/** The enrichment as the session row carries it: an unreported column is an empty string. */
function sessionRow(overrides: Partial<CodingAgentSession> = {}): CodingAgentSession {
  return codingAgentSessionFixture({
    repositoryHost: "",
    repositoryOwner: "",
    repositoryName: "",
    gitBranch: "",
    gitWorktree: "",
    title: "",
    ...overrides,
  });
}

function harness({
  rows,
  sessions = {},
  protections = FULL_VIEW,
  links = [],
  organizationId = "org-1",
  overrides = {},
}: {
  rows: PageRow[];
  sessions?: Record<string, CodingAgentSession>;
  protections?: Protections;
  links?: CodingAgentTracePullRequestLink[];
  organizationId?: string | undefined;
  overrides?: Partial<CodingAgentSessionGroupsSessions>;
}) {
  const resolveViewerProtections = vi.fn<TraceApi["resolveViewerProtections"]>(
    async () => protections,
  );
  const readSessionGroups = vi.fn<TraceApi["readSessionGroups"]>(async () => ({
    sessions: rows,
    totalHits: rows.length,
    nextCursor: null,
  }));
  const linkTraceSessionsToPullRequests = vi.fn<
    CodingAgentSessionGroupsSessions["linkTraceSessionsToPullRequests"]
  >(async () => links);
  const service = CodingAgentSessionGroupsReadService.create({
    traces: { resolveViewerProtections, readSessionGroups },
    sessions: {
      findBySessionId: async (input) => sessions[input.sessionId] ?? null,
      linkTraceSessionsToPullRequests,
      ...overrides,
    },
    findOrganizationForProject: async () => organizationId,
  });
  const read = () =>
    service.readForViewer({
      projectId: PROJECT_ID,
      timeRange: { from: 0, to: 2_000_000_000_000 },
      pageSize: 10,
      viewerUserId: VIEWER,
    });

  return { read, resolveViewerProtections, readSessionGroups, linkTraceSessionsToPullRequests };
}

describe("CodingAgentSessionGroupsReadService", () => {
  describe("given a signed-in viewer reading the Sessions lens", () => {
    /** @scenario "The Sessions lens page is read through the signed-in viewer's protections" */
    it("asks trace for the page under that viewer's protections and enriches what it returns", async () => {
      const protections: Protections = { ...FULL_VIEW, canSeeCosts: false };
      const { read, resolveViewerProtections, readSessionGroups } = harness({
        rows: [pageRow()],
        sessions: { "session-a": sessionRow({ modelCalls: 4 }) },
        protections,
      });

      const page = await read();

      expect(resolveViewerProtections).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        userId: VIEWER,
      });
      expect(readSessionGroups).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: PROJECT_ID, pageSize: 10, protections }),
      );
      expect(readSessionGroups.mock.calls[0]?.[0]).not.toHaveProperty("viewerUserId");
      expect(page.sessions[0]?.codingAgent?.modelCalls).toBe(4);
    });
  });

  describe("given a page of sessions, one of them a coding-agent session", () => {
    /** @scenario Coding agent enrichment attaches model calls and compactions */
    it("attaches the coding-agent counters to that session and leaves the other empty", async () => {
      const { read } = harness({
        rows: [pageRow(), pageRow({ conversationId: "session-b" })],
        sessions: {
          "session-a": sessionRow({
            modelCalls: 41,
            compactions: 2,
            peakContextTokens: 180_000,
            subAgents: 3,
          }),
        },
      });

      const page = await read();

      expect(page.sessions[0]?.codingAgent).toEqual({
        modelCalls: 41,
        compactions: 2,
        peakContextTokens: 180_000,
        subAgents: 3,
        repositoryHost: null,
        repositoryOwner: null,
        repositoryName: null,
        gitBranch: null,
        gitWorktree: null,
        title: null,
        titleRedacted: false,
        pullRequest: null,
      });
      expect(page.sessions[1]?.codingAgent).toBeNull();
    });

    /** @scenario Coding agent enrichment carries repository, branch, worktree and title */
    it("carries the repository, branch, worktree and title, empty where unreported", async () => {
      const { read } = harness({
        rows: [pageRow(), pageRow({ conversationId: "session-b" })],
        sessions: {
          "session-a": sessionRow({
            repositoryHost: "github.com",
            repositoryOwner: "acme",
            repositoryName: "widgets",
            gitBranch: "feat/git-context",
            gitWorktree: "widgets-feat",
            title: "Add git context to the session row",
          }),
          "session-b": sessionRow(),
        },
      });

      const page = await read();

      expect(page.sessions[0]?.codingAgent).toMatchObject({
        repositoryHost: "github.com",
        repositoryOwner: "acme",
        repositoryName: "widgets",
        gitBranch: "feat/git-context",
        gitWorktree: "widgets-feat",
        title: "Add git context to the session row",
      });
      expect(page.sessions[1]?.codingAgent).toMatchObject({
        repositoryHost: null,
        gitBranch: null,
        gitWorktree: null,
        title: null,
      });
    });

    it("applies the canonical pull-request link to the session, in one lookup for the page", async () => {
      const pullRequest = {
        number: 7,
        htmlUrl: "https://github.com/acme/widgets/pull/7",
        title: "Link sessions to pull requests",
      };
      const { read, linkTraceSessionsToPullRequests } = harness({
        rows: [pageRow()],
        sessions: { "session-a": sessionRow({ gitBranch: "feat/linkage" }) },
        links: [{ sessionId: "session-a", pullRequest }],
      });

      const page = await read();

      expect(linkTraceSessionsToPullRequests).toHaveBeenCalledTimes(1);
      expect(page.sessions[0]?.codingAgent?.pullRequest).toEqual(pullRequest);
    });
  });

  describe("given the enrichment lookup or the pull-request join fails", () => {
    /** @scenario "A failed coding-agent enrichment leaves the Sessions lens page whole" */
    it("returns every session, unenriched or unlinked, rather than failing the page", async () => {
      const lookupFails = harness({
        rows: [pageRow()],
        overrides: {
          findBySessionId: async () => {
            throw new Error("clickhouse hiccup");
          },
        },
      });
      const joinFails = harness({
        rows: [pageRow()],
        sessions: { "session-a": sessionRow({ modelCalls: 2 }) },
        overrides: {
          linkTraceSessionsToPullRequests: async () => {
            throw new Error("github unreachable");
          },
        },
      });

      const [unenriched, unlinked] = await Promise.all([lookupFails.read(), joinFails.read()]);

      expect(unenriched.sessions.map((session) => session.codingAgent)).toEqual([null]);
      expect(unlinked.sessions[0]?.codingAgent).toMatchObject({ modelCalls: 2, pullRequest: null });
    });
  });

  describe("given a session older than the viewer's visibility window", () => {
    /** @scenario A session beyond the visibility window teases its title */
    it("teases the generated title as trace teased the previews, and leaves the git context whole", async () => {
      const title = "Rebuild the flaky session fold test and its ClickHouse fixture";
      const { read } = harness({
        rows: [pageRow({ lastActivityMs: 1000 })],
        sessions: {
          "session-a": sessionRow({
            title,
            repositoryOwner: "acme",
            gitBranch: "feat/git-context",
          }),
        },
        protections: { ...FULL_VIEW, visibilityCutoffMs: 2000 },
      });

      const codingAgent = (await read()).sessions[0]?.codingAgent;

      expect(codingAgent?.title).toBe(teaserOf(title));
      expect(codingAgent?.title).not.toBe(title);
      expect(codingAgent).toMatchObject({ repositoryOwner: "acme", gitBranch: "feat/git-context" });
    });
  });

  describe("given a viewer who cannot read captured content", () => {
    it("strips the title and marks it redacted", async () => {
      const { read } = harness({
        rows: [pageRow()],
        sessions: { "session-a": sessionRow({ title: "Fix the flaky test" }) },
        protections: { canSeeCapturedInput: false, canSeeCapturedOutput: true },
      });

      const codingAgent = (await read()).sessions[0]?.codingAgent;

      expect(codingAgent).toMatchObject({ title: null, titleRedacted: true });
    });
  });
});
