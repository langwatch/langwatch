import { describe, expect, it } from "vitest";
import { MAX_SESSION_EVENTS_PAGE_SIZE } from "../src/services/coding-agent.service";
import { CodingAgentFeatureService } from "../src/services/coding-agent.service";
import { CODING_AGENT_SESSION_READ_WINDOW_MS } from "../src/services/coding-agent-session-read.service";
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
} from "./fixtures/coding-agent.fixture";

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

  it("does not widen an inferred window when a kind filter explains the empty page", async () => {
    const sessions = new TestSessions();
    sessions.rows = [session()];
    const events = new TestEvents();
    const service = serviceWith({ sessions, events });

    await service.getSessionEvents({
      projectId: PROJECT,
      sessionId: SESSION,
      kinds: ["compaction"],
      limit: 25,
    });

    expect(events.inputs).toHaveLength(1);
    expect(events.inputs[0]?.kinds).toEqual(["compaction"]);
  });

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

  it("does not query sessions when a trace has no Coding Agent mapping", async () => {
    const sessions = new TestSessions();
    const service = serviceWith({ sessions });

    await expect(
      service.tryGetSessionForTrace({ projectId: PROJECT, traceId: TRACE }),
    ).resolves.toBeNull();

    expect(sessions.findInputs).toEqual([]);
  });

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
});
