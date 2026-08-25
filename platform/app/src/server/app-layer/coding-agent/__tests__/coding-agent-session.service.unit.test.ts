/**
 * Read side of the coding-agent session aggregate (ADR-056).
 *
 * @see specs/coding-agent/session-aggregate.feature
 * @see specs/coding-agent/personal-usage.feature
 */
import { describe, expect, it } from "vitest";
import type { CodingAgentSessionRow } from "~/server/event-sourcing/pipelines/coding-agent-processing/projections/codingAgentSession.foldProjection";
import {
  CODING_AGENT_SESSION_PROJECTION_VERSION_LATEST,
  CODING_AGENT_SESSION_READ_WINDOW_MS,
  projectCodingAgentSessionToRow,
} from "~/server/event-sourcing/pipelines/coding-agent-processing/projections/codingAgentSession.foldProjection";
import {
  CodingAgentSessionService,
  MAX_SESSION_EVENTS_PAGE_SIZE,
} from "../coding-agent-session.service";
import type { CodingAgentSessionRepository } from "../repositories/coding-agent-session.repository";
import type { CodingAgentSessionEventRow } from "../repositories/coding-agent-session-events.repository";
import { NullCodingAgentSessionEventsRepository } from "../repositories/coding-agent-session-events.repository";
import type { CodingAgentTraceSessionRepository } from "../repositories/coding-agent-trace-session.repository";
import type {
  SessionMetricSeriesRepository,
  SessionMetricTotal,
} from "../repositories/session-metric-series.repository";

const PROJECT = "project-1";
const SESSION = "sess-1";
const TRACE = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6";
const STARTED_AT_MS = 1_700_000_000_000;

/** One row back from a session-events read; only its presence is asserted. */
const SESSION_EVENT = {
  sessionId: SESSION,
  timeUnixMs: STARTED_AT_MS,
  recordId: "rec-1",
  eventKind: "model_call",
} as CodingAgentSessionEventRow;

function makeRow(overrides?: Partial<CodingAgentSessionRow>): CodingAgentSessionRow {
  const base = projectCodingAgentSessionToRow({
    state: {
      // A structurally-complete empty state via the projection itself would
      // need the fold; build the row from a minimal literal instead.
      ...emptyState(),
      sessionKeySource: "provider",
      traceIds: [TRACE],
      startedAtMs: STARTED_AT_MS,
      createdAt: 0,
      updatedAt: 0,
      LastEventOccurredAt: 0,
    },
    tenantId: PROJECT,
    sessionId: SESSION,
    version: CODING_AGENT_SESSION_PROJECTION_VERSION_LATEST,
  });
  return { ...base, ...overrides };
}

function emptyState() {
  return {
    agent: "claude_code" as string | null,
    sessionId: SESSION as string | null,
    agentVersion: null,
    terminalType: null,
    entrypoint: null,
    finalRequestId: null,
    userId: "user-1" as string | null,
    parentSessionId: null,
    isFork: false,
    repositoryHost: null,
    repositoryOwner: null,
    repositoryName: null,
    gitBranch: null,
    gitBranches: [] as string[],
    gitWorktree: null,
    title: null,
    titleSource: null,
    modelCalls: 0,
    toolCalls: 0,
    subAgents: 0,
    subAgentIds: [],
    steps: [],
    prompts: 0,
    promptChars: 0,
    responseChars: 0,
    toolCounts: {},
    toolDurationMs: {},
    filesTouched: [],
    skills: [],
    subAgentTypes: [],
    slashCommands: [],
    models: [],
    mcpServers: [],
    mcpTools: [],
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    costUsd: 0,
    agentReportedCostUsd: 0,
    modelCallMs: 0,
    toolMs: 0,
    ttftMsTotal: 0,
    ttftSamples: 0,
    blockedOnUserMs: 0,
    activeTimeUserSec: 0,
    activeTimeCliSec: 0,
    toolResultBytes: 0,
    toolInputBytes: 0,
    compactions: 0,
    compactionTokensBefore: 0,
    compactionTokensAfter: 0,
    compactionTriggers: {},
    peakContextTokens: 0,
    cacheRebuildCount: 0,
    largestCacheRebuildTokens: 0,
    previousCallContextTokens: 0,
    metricSeries: {},
    failedTools: 0,
    errorTypes: {},
    apiErrors: 0,
    rateLimited: 0,
    rateLimitEvents: 0,
    retriesExhausted: 0,
    retryMs: 0,
    attempts: 0,
    refusals: 0,
    refusalCategories: [],
    internalErrors: 0,
    toolsDenied: 0,
    toolsAborted: 0,
    permissionMode: null,
    permissionChanges: 0,
    hooksBlocked: 0,
    hooksCancelled: 0,
    hookMs: 0,
    linesAdded: 0,
    linesRemoved: 0,
    commits: 0,
    pullRequests: 0,
    editsAccepted: 0,
    editsRejected: 0,
    languagesEdited: [],
    atMentions: 0,
    stopReason: null,
    truncated: false,
  };
}

/** The window a session-events read was bounded by, or undefined if unbounded. */
type ReadWindow = { fromMs: number; toMs: number } | undefined;

function makeService({
  row = null,
  rows,
  mapping = null,
  totals = [],
  onEventsRead,
}: {
  row?: CodingAgentSessionRow | null;
  rows?: CodingAgentSessionRow[];
  mapping?: { sessionId: string; occurredAtMs: number } | null;
  totals?: SessionMetricTotal[];
  /** Answers a session-events read, so a test can observe the window it got. */
  onEventsRead?: (args: { occurredAt: ReadWindow }) => {
    events: CodingAgentSessionEventRow[];
    nextCursor: null;
  };
}) {
  const listed = rows ?? (row ? [row] : []);
  const sessions: CodingAgentSessionRepository = {
    upsert: async () => {},
    findBySessionId: async () => row,
    findBySessionIdWithApplied: async () => (row ? { row, appliedEventIds: [] } : null),
    findManyRecent: async () => listed,
    listByRepositoryBranch: async () => [],
  };
  const traceSessions: CodingAgentTraceSessionRepository = {
    ensure: async () => {},
    findByTraceId: async () =>
      mapping ? { tenantId: PROJECT, traceId: TRACE, ...mapping } : null,
  };
  const metricSeries: SessionMetricSeriesRepository = {
    ensure: async () => {},
    findTotalsBySessionIds: async () => totals,
  };
  return new CodingAgentSessionService({
    sessions,
    traceSessions,
    metricSeries,
    sessionEvents: onEventsRead
      ? {
          ensure: async () => {},
          findBySessionId: async ({ occurredAt }) => onEventsRead({ occurredAt }),
          sumTokensByModelPerSession: async () => [],
        }
      : new NullCodingAgentSessionEventsRepository(),
  });
}

describe("CodingAgentSessionService", () => {
  describe("when a caller asks for more session events than one page holds", () => {
    it("clamps the limit the repository sees to the page ceiling", async () => {
      const seen: number[] = [];
      const service = new CodingAgentSessionService({
        sessions: {
          upsert: async () => {},
          findBySessionId: async () => null,
          findBySessionIdWithApplied: async () => null,
          findManyRecent: async () => [],
          listByRepositoryBranch: async () => [],
        },
        traceSessions: {
          ensure: async () => {},
          findByTraceId: async () => null,
        },
        metricSeries: {
          ensure: async () => {},
          findTotalsBySessionIds: async () => [],
        },
        sessionEvents: {
          ensure: async () => {},
          findBySessionId: async ({ limit }) => {
            seen.push(limit);
            return { events: [], nextCursor: null };
          },
          sumTokensByModelPerSession: async () => [],
        },
      });

      await service.getSessionEvents({
        projectId: PROJECT,
        sessionId: SESSION,
        limit: 10_000_000,
      });
      await service.getSessionEvents({
        projectId: PROJECT,
        sessionId: SESSION,
        limit: 0,
      });
      await service.getSessionEvents({
        projectId: PROJECT,
        sessionId: SESSION,
        limit: 25,
      });

      expect(seen).toEqual([MAX_SESSION_EVENTS_PAGE_SIZE, 1, 25]);
    });
  });

  describe("given a session whose events are asked for without a window", () => {
    /** @scenario reading a session's events prunes to the session's own weeks */
    it("bounds the read on the session's start instead of every partition", async () => {
      const windows: ReadWindow[] = [];
      const service = makeService({
        row: makeRow(),
        onEventsRead: ({ occurredAt }) => {
          windows.push(occurredAt);
          return { events: [SESSION_EVENT], nextCursor: null };
        },
      });

      await service.getSessionEvents({
        projectId: PROJECT,
        sessionId: SESSION,
        limit: 25,
      });

      expect(windows).toEqual([
        {
          fromMs: STARTED_AT_MS - CODING_AGENT_SESSION_READ_WINDOW_MS,
          toMs: STARTED_AT_MS + CODING_AGENT_SESSION_READ_WINDOW_MS,
        },
      ]);
    });

    describe("when the session outlived the window we guessed", () => {
      /** @scenario a session longer than the guessed window still answers in full */
      it("pushes the upper edge out to now rather than answering empty", async () => {
        const windows: ReadWindow[] = [];
        const service = makeService({
          row: makeRow(),
          onEventsRead: ({ occurredAt }) => {
            windows.push(occurredAt);
            // Empty until the read reaches past the guessed upper edge.
            const reachesNow =
              occurredAt !== undefined &&
              occurredAt.toMs > STARTED_AT_MS + CODING_AGENT_SESSION_READ_WINDOW_MS;
            return reachesNow
              ? { events: [SESSION_EVENT], nextCursor: null }
              : { events: [], nextCursor: null };
          },
        });

        const page = await service.getSessionEvents({
          projectId: PROJECT,
          sessionId: SESSION,
          limit: 25,
        });

        expect(windows).toHaveLength(2);
        expect(page.events).toHaveLength(1);
        // The retry stays bounded: only the upper edge moves, so the read
        // still prunes every partition older than the session itself.
        expect(windows[1]?.fromMs).toBe(windows[0]?.fromMs);
        expect(windows[1]!.toMs).toBeGreaterThan(windows[0]!.toMs);
      });

      // The retry fires on ANY empty first page, and `kinds` can empty one on
      // its own. Were the retry unbounded, asking for a kind the session never
      // produced would walk the whole retention on every single read.
      /** @scenario a session longer than the guessed window still answers in full */
      it("stays bounded when a kinds filter is what emptied the page", async () => {
        const windows: ReadWindow[] = [];
        const service = makeService({
          row: makeRow(),
          onEventsRead: ({ occurredAt }) => {
            windows.push(occurredAt);
            return { events: [], nextCursor: null };
          },
        });

        const page = await service.getSessionEvents({
          projectId: PROJECT,
          sessionId: SESSION,
          kinds: ["compaction"],
          limit: 25,
        });

        expect(page.events).toEqual([]);
        expect(windows).toHaveLength(2);
        expect(windows[1]).toBeDefined();
        expect(windows[1]?.fromMs).toBe(
          STARTED_AT_MS - CODING_AGENT_SESSION_READ_WINDOW_MS,
        );
      });
    });
  });

  describe("given a caller that named its own window", () => {
    /** @scenario a caller's own window is never widened behind its back */
    it("passes it through and never retries unbounded", async () => {
      const windows: ReadWindow[] = [];
      const service = makeService({
        row: makeRow(),
        onEventsRead: ({ occurredAt }) => {
          windows.push(occurredAt);
          return { events: [], nextCursor: null };
        },
      });

      const asked = { fromMs: 1_000, toMs: 2_000 };
      const page = await service.getSessionEvents({
        projectId: PROJECT,
        sessionId: SESSION,
        occurredAt: asked,
        limit: 25,
      });

      expect(windows).toEqual([asked]);
      expect(page.events).toEqual([]);
    });
  });

  describe("when a trace belongs to a coding-agent session", () => {
    /** @scenario the trace view shows its session */
    it("resolves the session through the trace mapping", async () => {
      const row = makeRow({ modelCalls: 3, costUsd: 1.2 });
      const service = makeService({
        row,
        mapping: { sessionId: SESSION, occurredAtMs: row.startedAtMs },
      });

      const session = await service.tryGetSessionForTrace({
        projectId: PROJECT,
        traceId: TRACE,
      });

      expect(session?.sessionId).toBe(SESSION);
      expect(session?.modelCalls).toBe(3);
    });
  });

  describe("given a session whose row sits outside the caller's hint window", () => {
    describe("when the session is looked up with that hint", () => {
      /** @scenario a stale hint degrades to a slower read, not a missing session */
      it("retries without the window and returns the session", async () => {
        const row = makeRow({ modelCalls: 5 });
        const findCalls: Array<{
          window?: { fromMs: number; toMs: number };
        }> = [];
        const sessions: CodingAgentSessionRepository = {
          upsert: async () => {},
          // The row is only visible to an unwindowed read — the hint misses.
          findBySessionId: async (params) => {
            findCalls.push({ window: params.window });
            return params.window === undefined ? row : null;
          },
          findBySessionIdWithApplied: async () => null,
          findManyRecent: async () => [],
          listByRepositoryBranch: async () => [],
        };
        const service = new CodingAgentSessionService({
          sessions,
          traceSessions: {
            ensure: async () => {},
            findByTraceId: async () => null,
          },
          metricSeries: {
            ensure: async () => {},
            findTotalsBySessionIds: async () => [],
          },
          sessionEvents: new NullCodingAgentSessionEventsRepository(),
        });

        const session = await service.tryGetBySessionId({
          projectId: PROJECT,
          sessionId: SESSION,
          startedAtMs: row.startedAtMs,
        });

        expect(session?.modelCalls).toBe(5);
        expect(findCalls).toHaveLength(2);
        expect(findCalls[0]!.window).toBeDefined();
        expect(findCalls[1]!.window).toBeUndefined();
      });
    });
  });

  describe("when a trace is not a coding agent's", () => {
    /** @scenario traces from other sources are untouched */
    it("returns null without touching the session table", async () => {
      const service = makeService({ row: makeRow(), mapping: null });

      const session = await service.tryGetSessionForTrace({
        projectId: PROJECT,
        traceId: TRACE,
      });

      expect(session).toBeNull();
    });
  });

  describe("when a session sent only metrics", () => {
    /** @scenario usage counts metric-only sessions */
    it("fills cost and tokens from the converged series", async () => {
      const row = makeRow(); // zero cost, zero tokens — no spans, no logs
      const service = makeService({
        row,
        totals: [
          {
            sessionId: SESSION,
            metricName: "claude_code.cost.usage",
            bucket: "",
            total: 0.8,
          },
          {
            sessionId: SESSION,
            metricName: "claude_code.token.usage",
            bucket: "input",
            total: 1_000,
          },
          {
            sessionId: SESSION,
            metricName: "claude_code.token.usage",
            bucket: "cacheRead",
            total: 9_000,
          },
        ],
      });

      const sessions = await service.listRecent({
        projectId: PROJECT,
        fromMs: 0,
        toMs: 2_000_000_000_000,
      });

      expect(sessions[0]!.costUsd).toBe(0.8);
      expect(sessions[0]!.inputTokens).toBe(1_000);
      expect(sessions[0]!.cacheReadTokens).toBe(9_000);
    });

    it("never overwrites tokens a span already carried", async () => {
      const row = makeRow({ inputTokens: 500, costUsd: 2.5 });
      const service = makeService({
        row,
        totals: [
          {
            sessionId: SESSION,
            metricName: "claude_code.token.usage",
            bucket: "input",
            total: 999_999,
          },
          {
            sessionId: SESSION,
            metricName: "claude_code.cost.usage",
            bucket: "",
            total: 999,
          },
        ],
      });

      const session = await service.tryGetBySessionId({
        projectId: PROJECT,
        sessionId: SESSION,
      });

      expect(session?.inputTokens).toBe(500);
      expect(session?.costUsd).toBe(2.5);
    });
  });

  describe("when computing usage totals over a period", () => {
    /** @scenario my recent usage at a glance */
    it("sums cost, tokens, active time and counts the sessions", async () => {
      const service = makeService({
        rows: [
          makeRow({
            sessionId: "s-a",
            costUsd: 1.5,
            inputTokens: 100,
            outputTokens: 50,
            cacheReadTokens: 900,
            cacheCreationTokens: 10,
            activeTimeUserSec: 120,
            activeTimeCliSec: 300,
            commits: 2,
          }),
          makeRow({
            sessionId: "s-b",
            costUsd: 0.5,
            inputTokens: 20,
            outputTokens: 5,
            activeTimeCliSec: 60,
            pullRequests: 1,
          }),
        ],
      });

      const totals = await service.getUsageTotals({
        projectId: PROJECT,
        fromMs: 0,
        toMs: 2_000_000_000_000,
      });

      expect(totals.sessionCount).toBe(2);
      expect(totals.costUsd).toBeCloseTo(2.0);
      expect(totals.totalTokens).toBe(100 + 50 + 900 + 10 + 20 + 5);
      expect(totals.activeTimeSec).toBe(120 + 300 + 60);
      expect(totals.commits).toBe(2);
      expect(totals.pullRequests).toBe(1);
    });

    /** @scenario usage counts metric-only sessions */
    it("includes a metric-only session's overlaid cost in the totals", async () => {
      const service = makeService({
        rows: [makeRow({ sessionId: SESSION })], // no spans/logs → zero folded
        totals: [
          {
            sessionId: SESSION,
            metricName: "claude_code.cost.usage",
            bucket: "",
            total: 0.8,
          },
          {
            sessionId: SESSION,
            metricName: "claude_code.token.usage",
            bucket: "input",
            total: 1_000,
          },
        ],
      });

      const totals = await service.getUsageTotals({
        projectId: PROJECT,
        fromMs: 0,
        toMs: 2_000_000_000_000,
      });

      expect(totals.sessionCount).toBe(1);
      expect(totals.costUsd).toBeCloseTo(0.8);
      expect(totals.totalTokens).toBe(1_000);
    });

    /** @scenario no usage yet */
    it("returns zeroes when the user has no sessions", async () => {
      const service = makeService({ rows: [] });

      const totals = await service.getUsageTotals({
        projectId: PROJECT,
        fromMs: 0,
        toMs: 2_000_000_000_000,
      });

      expect(totals).toMatchObject({
        sessionCount: 0,
        costUsd: 0,
        totalTokens: 0,
        activeTimeSec: 0,
      });
    });
  });
});
