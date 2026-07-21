/**
 * Read side of the coding-agent session aggregate (ADR-056).
 *
 * @see specs/coding-agent/session-aggregate.feature
 * @see specs/coding-agent/personal-usage.feature
 */
import { describe, expect, it } from "vitest";
import type { CodingAgentSessionRow } from "~/server/event-sourcing/pipelines/coding-agent-processing/projections/codingAgentSession.foldProjection";
import { projectCodingAgentSessionToRow } from "~/server/event-sourcing/pipelines/coding-agent-processing/projections/codingAgentSession.foldProjection";
import { CodingAgentSessionService } from "../coding-agent-session.service";
import type { CodingAgentSessionRepository } from "../repositories/coding-agent-session.repository";
import type { CodingAgentTraceSessionRepository } from "../repositories/coding-agent-trace-session.repository";
import type {
  SessionMetricSeriesRepository,
  SessionMetricTotal,
} from "../repositories/session-metric-series.repository";

const PROJECT = "project-1";
const SESSION = "sess-1";
const TRACE = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6";

function makeRow(overrides?: Partial<CodingAgentSessionRow>): CodingAgentSessionRow {
  const base = projectCodingAgentSessionToRow({
    state: {
      // A structurally-complete empty state via the projection itself would
      // need the fold; build the row from a minimal literal instead.
      ...emptyState(),
      sessionKeySource: "provider",
      traceIds: [TRACE],
      startedAtMs: 1_700_000_000_000,
      createdAt: 0,
      updatedAt: 0,
      LastEventOccurredAt: 0,
    },
    tenantId: PROJECT,
    sessionId: SESSION,
    version: "2026-07-21",
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
    peakContextTokens: 0,
    cacheRebuildCount: 0,
    largestCacheRebuildTokens: 0,
    previousCallContextTokens: 0,
    metricSeries: {},
    failedTools: 0,
    errorTypes: {},
    apiErrors: 0,
    rateLimited: 0,
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

function makeService({
  row = null,
  rows,
  mapping = null,
  totals = [],
}: {
  row?: CodingAgentSessionRow | null;
  rows?: CodingAgentSessionRow[];
  mapping?: { sessionId: string; occurredAtMs: number } | null;
  totals?: SessionMetricTotal[];
}) {
  const listed = rows ?? (row ? [row] : []);
  const sessions: CodingAgentSessionRepository = {
    upsert: async () => {},
    findBySessionId: async () => row,
    findManyRecent: async () => listed,
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
  return new CodingAgentSessionService(sessions, traceSessions, metricSeries);
}

describe("CodingAgentSessionService", () => {
  describe("when a trace belongs to a coding-agent session", () => {
    /** @scenario the trace view shows its session */
    it("resolves the session through the trace mapping", async () => {
      const row = makeRow({ modelCalls: 3, costUsd: 1.2 });
      const service = makeService({
        row,
        mapping: { sessionId: SESSION, occurredAtMs: row.startedAtMs },
      });

      const session = await service.getSessionForTrace({
        projectId: PROJECT,
        traceId: TRACE,
      });

      expect(session?.sessionId).toBe(SESSION);
      expect(session?.modelCalls).toBe(3);
    });
  });

  describe("when a trace is not a coding agent's", () => {
    /** @scenario traces from other sources are untouched */
    it("returns null without touching the session table", async () => {
      const service = makeService({ row: makeRow(), mapping: null });

      const session = await service.getSessionForTrace({
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

      const session = await service.getBySessionId({
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
