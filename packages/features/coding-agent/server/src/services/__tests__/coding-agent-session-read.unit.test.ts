import { describe, expect, it } from "vitest";
import type { CodingAgentSessionEvent } from "@langwatch/coding-agent-contract";
import { MAX_SESSION_EVENTS_PAGE_SIZE } from "../coding-agent.service";
import { CodingAgentFeatureService } from "../coding-agent.service";
import { CODING_AGENT_SESSION_READ_WINDOW_MS } from "../coding-agent-session-read.service";
import {
  TEST_NOW_MS,
  TestBillingPolicy,
  TestClock,
  TestEvents,
  TestGithubService,
  TestMetricSeries,
  TestProjectService,
  TestSessions,
  TestTraceSessions,
  session,
} from "../../repositories/__tests__/fixtures/coding-agent.fixture";

const PROJECT = "project-1";
const SESSION = "session-1";
const TRACE = "trace-1";

function serviceWith(input: {
  sessions?: TestSessions;
  traceSessions?: TestTraceSessions;
  metricSeries?: TestMetricSeries;
  events?: TestEvents;
}) {
  return CodingAgentFeatureService.create({
    sessions: input.sessions ?? new TestSessions(),
    traceSessions: input.traceSessions ?? new TestTraceSessions(),
    metricSeries: input.metricSeries ?? new TestMetricSeries(),
    sessionEvents: input.events ?? new TestEvents(),
    github: new TestGithubService(),
    projects: new TestProjectService(),
    billing: new TestBillingPolicy(),
    clock: new TestClock(),
  });
}

describe("Coding Agent session reads", () => {
  /** @scenario "an event page is larger than the service permits" */
  it("clamps event pages at the package contract ceiling, including legacy limits", async () => {
    const events = new TestEvents();
    const service = serviceWith({ events });

    await service.getSessionEvents({
      projectId: PROJECT,
      sessionId: SESSION,
      limit: 10_000,
    });
    await service.getSessionEvents({ projectId: PROJECT, sessionId: SESSION, limit: 0 });
    await service.getSessionEvents({ projectId: PROJECT, sessionId: SESSION, limit: 25 });

    expect(events.inputs.map((input) => input.limit)).toEqual([
      MAX_SESSION_EVENTS_PAGE_SIZE,
      1,
      25,
    ]);
  });

  /**
   * @scenario "reading a session's events prunes to the session's own weeks"
   * @scenario "a session longer than the guessed window still answers in full"
   */
  it("bounds inferred event reads around the session and widens only the upper edge after an empty page", async () => {
    const sessions = new TestSessions();
    const row = session({
      startedAtMs: TEST_NOW_MS - CODING_AGENT_SESSION_READ_WINDOW_MS - 10_000,
    });
    sessions.rows = [row];
    const events = new TestEvents();
    events.pages = [
      { events: [], nextCursor: null },
      { events: [], nextCursor: null },
    ];
    const service = serviceWith({ sessions, events });

    await service.getSessionEvents({ projectId: PROJECT, sessionId: SESSION, limit: 25 });

    expect(events.inputs).toHaveLength(2);
    expect(events.inputs[0]?.occurredAt).toEqual({
      fromMs: row.startedAtMs - CODING_AGENT_SESSION_READ_WINDOW_MS,
      toMs: row.startedAtMs + CODING_AGENT_SESSION_READ_WINDOW_MS,
    });
    expect(events.inputs[1]?.occurredAt?.fromMs).toBe(
      events.inputs[0]?.occurredAt?.fromMs,
    );
    expect(events.inputs[1]?.occurredAt?.toMs).toBe(TEST_NOW_MS);
  });

  /** @scenario "a caller's own window is never widened behind its back" */
  it("does not widen an explicit event window", async () => {
    const events = new TestEvents();
    const service = serviceWith({ events });
    const occurredAt = { fromMs: 100, toMs: 200 };

    await service.getSessionEvents({
      projectId: PROJECT,
      sessionId: SESSION,
      occurredAt,
      kinds: ["compaction"],
      limit: 25,
    });

    expect(events.inputs).toEqual([
      expect.objectContaining({ occurredAt, kinds: ["compaction"], limit: 25 }),
    ]);
  });

  it("keeps the lower edge anchored when a kind filter explains the empty page", async () => {
    const sessions = new TestSessions();
    const row = session();
    sessions.rows = [row];
    const events = new TestEvents();
    const service = serviceWith({ sessions, events });

    await service.getSessionEvents({
      projectId: PROJECT,
      sessionId: SESSION,
      kinds: ["compaction"],
      limit: 25,
    });

    // The retry fires on any empty first page — kinds can empty one on its
    // own — but only the upper edge moves, so the lower bound stays put.
    expect(events.inputs).toHaveLength(2);
    expect(events.inputs[0]?.kinds).toEqual(["compaction"]);
    expect(events.inputs[1]?.occurredAt?.fromMs).toBe(
      row.startedAtMs - CODING_AGENT_SESSION_READ_WINDOW_MS,
    );
  });

  /** @scenario "the trace view shows its session" */
  it("resolves a trace through its tenant-scoped mapping and retries a stale session window unbounded", async () => {
    const sessions = new TestSessions();
    sessions.rows = [session({ modelCalls: 3 })];
    sessions.missWhenWindowed = true;
    const traceSessions = new TestTraceSessions();
    traceSessions.mapping = {
      tenantId: PROJECT,
      traceId: TRACE,
      sessionId: SESSION,
      occurredAtMs: TEST_NOW_MS - 10_000,
    };
    const service = serviceWith({ sessions, traceSessions });

    const resolved = await service.tryGetSessionForTrace({
      projectId: PROJECT,
      traceId: TRACE,
    });

    expect(resolved?.modelCalls).toBe(3);
    expect(traceSessions.inputs).toEqual([{ tenantId: PROJECT, traceId: TRACE }]);
    expect(sessions.findInputs.map((input) => input.window === undefined)).toEqual([
      false,
      true,
    ]);
  });

  /** @scenario "a stale hint degrades to a slower read, not a missing session" */
  it("retries a stale session hint without hiding the durable session", async () => {
    const sessions = new TestSessions();
    sessions.rows = [session({ modelCalls: 5 })];
    sessions.missWhenWindowed = true;
    const service = serviceWith({ sessions });

    const found = await service.tryGetBySessionId({
      projectId: PROJECT,
      sessionId: SESSION,
      startedAtMs: TEST_NOW_MS,
    });

    expect(found?.modelCalls).toBe(5);
    expect(sessions.findInputs).toHaveLength(2);
    expect(sessions.findInputs[0]?.window).toBeDefined();
    expect(sessions.findInputs[1]?.window).toBeUndefined();
  });

  /**
   * @scenario "a trace with no coding-agent mapping is optional discovery"
   * @scenario "traces from other sources are untouched"
   */
  it("does not query sessions when a trace has no Coding Agent mapping", async () => {
    const sessions = new TestSessions();
    const service = serviceWith({ sessions });

    await expect(
      service.tryGetSessionForTrace({ projectId: PROJECT, traceId: TRACE }),
    ).resolves.toBeNull();

    expect(sessions.findInputs).toEqual([]);
  });

  /** @scenario "metric-only sessions retain their usage totals" */
  it("overlays metric-only sessions without replacing span and log totals", async () => {
    const sessions = new TestSessions();
    sessions.rows = [
      session({ sessionId: "metric-only" }),
      session({ sessionId: "with-events", inputTokens: 500, costUsd: 2.5 }),
    ];
    const metrics = new TestMetricSeries();
    metrics.totals = [
      {
        sessionId: "metric-only",
        metricName: "claude_code.cost.usage",
        bucket: "",
        total: 0.8,
      },
      {
        sessionId: "metric-only",
        metricName: "claude_code.token.usage",
        bucket: "input",
        total: 1000,
      },
      {
        sessionId: "metric-only",
        metricName: "claude_code.token.usage",
        bucket: "cacheRead",
        total: 9000,
      },
      {
        sessionId: "with-events",
        metricName: "claude_code.cost.usage",
        bucket: "",
        total: 99,
      },
      {
        sessionId: "with-events",
        metricName: "claude_code.token.usage",
        bucket: "input",
        total: 99999,
      },
    ];
    const service = serviceWith({ sessions, metricSeries: metrics });

    const rows = await service.listRecent({
      projectId: PROJECT,
      fromMs: 0,
      toMs: TEST_NOW_MS,
    });

    expect(rows[0]).toMatchObject({
      costUsd: 0.8,
      inputTokens: 1000,
      cacheReadTokens: 9000,
    });
    expect(rows[1]).toMatchObject({ costUsd: 2.5, inputTokens: 500 });
    expect(metrics.inputs[0]).toMatchObject({
      tenantId: PROJECT,
      sessionIds: ["metric-only"],
    });
  });

  it("sums overlaid tokens, cost, time, and work counters across at most one thousand sessions", async () => {
    const sessions = new TestSessions();
    sessions.rows = [
      session({
        sessionId: "a",
        costUsd: 1.5,
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 900,
        cacheCreationTokens: 10,
        activeTimeUserSec: 120,
        activeTimeCliSec: 300,
        linesAdded: 7,
        linesRemoved: 3,
        commits: 2,
      }),
      session({
        sessionId: "b",
        costUsd: 0.5,
        inputTokens: 20,
        outputTokens: 5,
        activeTimeCliSec: 60,
        pullRequests: 1,
      }),
    ];
    const service = serviceWith({ sessions });

    const totals = await service.getUsageTotals({
      projectId: PROJECT,
      fromMs: 0,
      toMs: TEST_NOW_MS,
    });

    expect(totals).toEqual({
      sessionCount: 2,
      costUsd: 2,
      totalTokens: 1085,
      activeTimeSec: 480,
      linesAdded: 7,
      linesRemoved: 3,
      commits: 2,
      pullRequests: 1,
    });
    expect(sessions.recentInputs[0]?.limit).toBe(1000);
  });

  it("returns the zero usage shape when no session is present", async () => {
    const service = serviceWith({});

    await expect(
      service.getUsageTotals({ projectId: PROJECT, fromMs: 0, toMs: TEST_NOW_MS }),
    ).resolves.toEqual({
      sessionCount: 0,
      costUsd: 0,
      totalTokens: 0,
      activeTimeSec: 0,
      linesAdded: 0,
      linesRemoved: 0,
      commits: 0,
      pullRequests: 0,
    });
  });

  describe("when a caller asks for more session events than one page holds", () => {
    it("clamps the limit the repository sees to the page ceiling", async () => {
      const events = new TestEvents();
      const service = serviceWith({ events });

      await service.getSessionEvents({
        projectId: PROJECT,
        sessionId: SESSION,
        limit: 10_000_000,
      });
      await service.getSessionEvents({ projectId: PROJECT, sessionId: SESSION, limit: 0 });
      await service.getSessionEvents({ projectId: PROJECT, sessionId: SESSION, limit: 25 });

      expect(events.inputs.map((input) => input.limit)).toEqual([
        MAX_SESSION_EVENTS_PAGE_SIZE,
        1,
        25,
      ]);
    });
  });

  describe("given a session whose events are asked for without a window", () => {
    /** @scenario reading a session's events prunes to the session's own weeks */
    it("bounds the read on the session's start instead of every partition", async () => {
      const sessions = new TestSessions();
      const row = session({
        startedAtMs: TEST_NOW_MS - CODING_AGENT_SESSION_READ_WINDOW_MS - 10_000,
      });
      sessions.rows = [row];
      const events = new TestEvents();
      const service = serviceWith({ sessions, events });

      await service.getSessionEvents({ projectId: PROJECT, sessionId: SESSION, limit: 25 });

      expect(events.inputs[0]?.occurredAt).toEqual({
        fromMs: row.startedAtMs - CODING_AGENT_SESSION_READ_WINDOW_MS,
        toMs: row.startedAtMs + CODING_AGENT_SESSION_READ_WINDOW_MS,
      });
    });

    describe("when the session outlived the window we guessed", () => {
      /** @scenario a session longer than the guessed window still answers in full */
      it("pushes the upper edge out to now rather than answering empty", async () => {
        const sessions = new TestSessions();
        const row = session({
          startedAtMs: TEST_NOW_MS - CODING_AGENT_SESSION_READ_WINDOW_MS - 10_000,
        });
        sessions.rows = [row];
        const events = new TestEvents();
        const stubEvent = { sessionId: SESSION, timeUnixMs: row.startedAtMs } as CodingAgentSessionEvent;
        events.pages = [
          { events: [], nextCursor: null },
          { events: [stubEvent], nextCursor: null },
        ];
        const service = serviceWith({ sessions, events });

        const page = await service.getSessionEvents({
          projectId: PROJECT,
          sessionId: SESSION,
          limit: 25,
        });

        expect(events.inputs).toHaveLength(2);
        expect(page.events).toHaveLength(1);
        expect(events.inputs[1]?.occurredAt?.fromMs).toBe(events.inputs[0]?.occurredAt?.fromMs);
        expect(events.inputs[1]!.occurredAt!.toMs).toBeGreaterThan(
          events.inputs[0]!.occurredAt!.toMs,
        );
      });

      /** @scenario a session longer than the guessed window still answers in full */
      it("stays bounded when a kinds filter is what emptied the page", async () => {
        const sessions = new TestSessions();
        const row = session({
          startedAtMs: TEST_NOW_MS - CODING_AGENT_SESSION_READ_WINDOW_MS - 10_000,
        });
        sessions.rows = [row];
        const events = new TestEvents();
        const service = serviceWith({ sessions, events });

        const page = await service.getSessionEvents({
          projectId: PROJECT,
          sessionId: SESSION,
          kinds: ["compaction"],
          limit: 25,
        });

        expect(page.events).toEqual([]);
        expect(events.inputs).toHaveLength(2);
        expect(events.inputs[1]?.occurredAt?.fromMs).toBe(
          row.startedAtMs - CODING_AGENT_SESSION_READ_WINDOW_MS,
        );
      });
    });
  });

  describe("given a caller that named its own window", () => {
    /** @scenario a caller's own window is never widened behind its back */
    it("passes it through and never retries unbounded", async () => {
      const events = new TestEvents();
      const service = serviceWith({ events });
      const asked = { fromMs: 1_000, toMs: 2_000 };

      const page = await service.getSessionEvents({
        projectId: PROJECT,
        sessionId: SESSION,
        occurredAt: asked,
        limit: 25,
      });

      expect(events.inputs).toEqual([expect.objectContaining({ occurredAt: asked })]);
      expect(page.events).toEqual([]);
    });
  });

  describe("when a trace belongs to a coding-agent session", () => {
    /** @scenario the trace view shows its session */
    it("resolves the session through the trace mapping", async () => {
      const sessions = new TestSessions();
      const row = session({ modelCalls: 3, costUsd: 1.2 });
      sessions.rows = [row];
      const traceSessions = new TestTraceSessions();
      traceSessions.mapping = {
        tenantId: PROJECT,
        traceId: TRACE,
        sessionId: SESSION,
        occurredAtMs: row.startedAtMs,
      };
      const service = serviceWith({ sessions, traceSessions });

      const found = await service.tryGetSessionForTrace({ projectId: PROJECT, traceId: TRACE });

      expect(found?.sessionId).toBe(SESSION);
      expect(found?.modelCalls).toBe(3);
    });
  });

  describe("given a session whose row sits outside the caller's hint window", () => {
    describe("when the session is looked up with that hint", () => {
      /** @scenario a stale hint degrades to a slower read, not a missing session */
      it("retries without the window and returns the session", async () => {
        const sessions = new TestSessions();
        const row = session({ modelCalls: 5 });
        sessions.rows = [row];
        sessions.missWhenWindowed = true;
        const service = serviceWith({ sessions });

        const found = await service.tryGetBySessionId({
          projectId: PROJECT,
          sessionId: SESSION,
          startedAtMs: row.startedAtMs,
        });

        expect(found?.modelCalls).toBe(5);
        expect(sessions.findInputs).toHaveLength(2);
        expect(sessions.findInputs[0]?.window).toBeDefined();
        expect(sessions.findInputs[1]?.window).toBeUndefined();
      });
    });
  });

  describe("when a trace is not a coding agent's", () => {
    /** @scenario traces from other sources are untouched */
    it("returns null without touching the session table", async () => {
      const sessions = new TestSessions();
      sessions.rows = [session()];
      const service = serviceWith({ sessions });

      const found = await service.tryGetSessionForTrace({ projectId: PROJECT, traceId: TRACE });

      expect(found).toBeNull();
    });
  });

  describe("when a session sent only metrics", () => {
    /** @scenario usage counts metric-only sessions */
    it("fills cost and tokens from the converged series", async () => {
      const sessions = new TestSessions();
      const row = session(); // zero cost, zero tokens — no spans, no logs
      sessions.rows = [row];
      const metrics = new TestMetricSeries();
      metrics.totals = [
        { sessionId: SESSION, metricName: "claude_code.cost.usage", bucket: "", total: 0.8 },
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
      ];
      const service = serviceWith({ sessions, metricSeries: metrics });

      const rows = await service.listRecent({ projectId: PROJECT, fromMs: 0, toMs: TEST_NOW_MS });

      expect(rows[0]!.costUsd).toBe(0.8);
      expect(rows[0]!.inputTokens).toBe(1_000);
      expect(rows[0]!.cacheReadTokens).toBe(9_000);
    });

    it("never overwrites tokens a span already carried", async () => {
      const sessions = new TestSessions();
      const row = session({ inputTokens: 500, costUsd: 2.5 });
      sessions.rows = [row];
      const metrics = new TestMetricSeries();
      metrics.totals = [
        {
          sessionId: SESSION,
          metricName: "claude_code.token.usage",
          bucket: "input",
          total: 999_999,
        },
        { sessionId: SESSION, metricName: "claude_code.cost.usage", bucket: "", total: 999 },
      ];
      const service = serviceWith({ sessions, metricSeries: metrics });

      const found = await service.tryGetBySessionId({ projectId: PROJECT, sessionId: SESSION });

      expect(found?.inputTokens).toBe(500);
      expect(found?.costUsd).toBe(2.5);
    });
  });

  describe("when computing usage totals over a period", () => {
    /** @scenario my recent usage at a glance */
    it("sums cost, tokens, active time and counts the sessions", async () => {
      const sessions = new TestSessions();
      sessions.rows = [
        session({
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
        session({
          sessionId: "s-b",
          costUsd: 0.5,
          inputTokens: 20,
          outputTokens: 5,
          activeTimeCliSec: 60,
          pullRequests: 1,
        }),
      ];
      const service = serviceWith({ sessions });

      const totals = await service.getUsageTotals({ projectId: PROJECT, fromMs: 0, toMs: TEST_NOW_MS });

      expect(totals.sessionCount).toBe(2);
      expect(totals.costUsd).toBeCloseTo(2.0);
      expect(totals.totalTokens).toBe(100 + 50 + 900 + 10 + 20 + 5);
      expect(totals.activeTimeSec).toBe(120 + 300 + 60);
      expect(totals.commits).toBe(2);
      expect(totals.pullRequests).toBe(1);
    });

    /** @scenario usage counts metric-only sessions */
    it("includes a metric-only session's overlaid cost in the totals", async () => {
      const sessions = new TestSessions();
      sessions.rows = [session({ sessionId: SESSION })]; // no spans/logs → zero folded
      const metrics = new TestMetricSeries();
      metrics.totals = [
        { sessionId: SESSION, metricName: "claude_code.cost.usage", bucket: "", total: 0.8 },
        {
          sessionId: SESSION,
          metricName: "claude_code.token.usage",
          bucket: "input",
          total: 1_000,
        },
      ];
      const service = serviceWith({ sessions, metricSeries: metrics });

      const totals = await service.getUsageTotals({ projectId: PROJECT, fromMs: 0, toMs: TEST_NOW_MS });

      expect(totals.sessionCount).toBe(1);
      expect(totals.costUsd).toBeCloseTo(0.8);
      expect(totals.totalTokens).toBe(1_000);
    });

    /** @scenario no usage yet */
    it("returns zeroes when the user has no sessions", async () => {
      const sessions = new TestSessions();
      sessions.rows = [];
      const service = serviceWith({ sessions });

      const totals = await service.getUsageTotals({ projectId: PROJECT, fromMs: 0, toMs: TEST_NOW_MS });

      expect(totals).toMatchObject({
        sessionCount: 0,
        costUsd: 0,
        totalTokens: 0,
        activeTimeSec: 0,
      });
    });
  });
});
