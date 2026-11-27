/**
 * @vitest-environment node
 * The contract of the four rows the coding-agent module owns, stated once and
 * run against every backend the package can reach. The memory twin runs
 * always; the ClickHouse tier joins the table where an endpoint is declared.
 */
import { describe, expect, it } from "vitest";

import { session, sessionEventRecord } from "../../__tests__/fixtures/coding-agent.fixture.ts";
import type { CodingAgentRepositories } from "../coding-agent.repositories.ts";
import { MemoryCodingAgentRepositories } from "../memory/memory.coding-agent.repositories.ts";

const backends: readonly { name: string; create: () => CodingAgentRepositories }[] = [
  { name: "memory", create: () => MemoryCodingAgentRepositories.create() },
];

describe.each(backends)("given the $name coding-agent repositories", ({ create }) => {
  describe("when a folded session is stored", () => {
    it("reads the session back with the events applied to it", async () => {
      const repositories = create();
      const row = session({ tenantId: "project-1", sessionId: "session-1" });

      await repositories.sessions.upsert(row, 30, ["event-1"]);

      await expect(
        repositories.sessions.findBySessionIdWithApplied({
          tenantId: "project-1",
          sessionId: "session-1",
        }),
      ).resolves.toEqual({ row, appliedEventIds: ["event-1"] });
    });

    it("answers nothing for another tenant naming the same session", async () => {
      const repositories = create();

      await repositories.sessions.upsert(
        session({ tenantId: "project-1", sessionId: "session-1" }),
        30,
        [],
      );

      await expect(
        repositories.sessions.findBySessionId({
          tenantId: "project-2",
          sessionId: "session-1",
        }),
      ).resolves.toBeNull();
    });

    it("merges the applied events of a redelivered fold rather than replacing them", async () => {
      const repositories = create();
      const row = session({ tenantId: "project-1", sessionId: "session-1" });

      await repositories.sessions.upsert(row, 30, ["event-1"]);
      await repositories.sessions.upsert(row, 30, ["event-2"]);

      const stored = await repositories.sessions.findBySessionIdWithApplied({
        tenantId: "project-1",
        sessionId: "session-1",
      });

      expect(stored?.appliedEventIds).toEqual(["event-1", "event-2"]);
    });
  });

  describe("when asked what other session a project holds", () => {
    const kindOf = (repositories: ReturnType<typeof create>, excluded: string) =>
      repositories.sessions.findOtherSessionKind({
        tenantId: "project-1",
        excludeSessionIds: [excluded],
      });

    /** @scenario "A project with an older session is never first" */
    it("answers main when a different main session of the tenant is stored", async () => {
      const repositories = create();
      await repositories.sessions.upsert(
        session({ tenantId: "project-1", sessionId: "session-1" }),
        30,
        [],
      );

      await expect(kindOf(repositories, "session-2")).resolves.toBe("main");
    });

    it("answers none when the only stored session is the excluded one", async () => {
      const repositories = create();
      await repositories.sessions.upsert(
        session({ tenantId: "project-1", sessionId: "session-1" }),
        30,
        [],
      );

      await expect(kindOf(repositories, "session-1")).resolves.toBe("none");
    });

    /** @scenario "A helper-thread session in the history never blocks the first" */
    it("answers helpers_only when the only other session is a helper thread", async () => {
      const repositories = create();
      await repositories.sessions.upsert(
        session({ tenantId: "project-1", sessionId: "helper-1", auxiliary: true }),
        30,
        [],
      );

      await expect(kindOf(repositories, "session-1")).resolves.toBe("helpers_only");
    });

    it("answers main when a helper thread and a main session are both stored", async () => {
      const repositories = create();
      await repositories.sessions.upsert(
        session({ tenantId: "project-1", sessionId: "helper-1", auxiliary: true }),
        30,
        [],
      );
      await repositories.sessions.upsert(
        session({ tenantId: "project-1", sessionId: "session-3" }),
        30,
        [],
      );

      await expect(kindOf(repositories, "session-1")).resolves.toBe("main");
    });

    it("answers none when only another tenant holds sessions", async () => {
      const repositories = create();
      await repositories.sessions.upsert(
        session({ tenantId: "project-2", sessionId: "session-9" }),
        30,
        [],
      );

      await expect(kindOf(repositories, "session-1")).resolves.toBe("none");
    });
  });

  describe("when a session's events are appended", () => {
    it("lists them in time order, bounded by the caller's page size", async () => {
      const repositories = create();

      await repositories.sessionEvents.ensure(
        [
          sessionEventRecord({ recordId: "event-2", timeUnixMs: 2_000 }),
          sessionEventRecord({ recordId: "event-1", timeUnixMs: 1_000 }),
        ],
        30,
      );

      const page = await repositories.sessionEvents.listBySessionId({
        tenantId: "project-1",
        sessionId: "session-1",
        limit: 1,
      });

      expect(page.events.map((event) => event.recordId)).toEqual(["event-1"]);
      expect(page.nextCursor).toEqual({ timeUnixMs: 1_000, recordId: "event-1" });
    });

    it("counts a redelivered event once", async () => {
      const repositories = create();
      const record = sessionEventRecord({ recordId: "event-1", inputTokens: 7, outputTokens: 3 });

      await repositories.sessionEvents.ensure([record], 30);
      await repositories.sessionEvents.ensure([record], 30);

      const totals = await repositories.sessionEvents.sumTokensByModelPerSession({
        tenantIds: ["project-1"],
        sessionIds: ["session-1"],
        fromMs: 0,
      });

      expect(totals.map((total) => [total.inputTokens, total.outputTokens])).toEqual([[7, 3]]);
    });
  });

  describe("when a trace is mapped to its session", () => {
    it("reads the mapping back for that tenant only", async () => {
      const repositories = create();
      const record = {
        tenantId: "project-1",
        traceId: "trace-1",
        sessionId: "session-1",
        occurredAtMs: 1_000,
      };

      await repositories.traceSessions.ensure([record], 30);

      await expect(
        repositories.traceSessions.findByTraceId({ tenantId: "project-1", traceId: "trace-1" }),
      ).resolves.toEqual(record);
      await expect(
        repositories.traceSessions.findByTraceId({ tenantId: "project-2", traceId: "trace-1" }),
      ).resolves.toBeNull();
    });

    /**
     * @scenario "The session's latest stored trace is found through its own trace map"
     * @scenario "The repository answers a session's newest mapped traces, newest first"
     */
    it("answers the session's mappings inside the window, newest first, up to the limit", async () => {
      const repositories = create();
      const mapping = (traceId: string, sessionId: string, occurredAtMs: number) => ({
        tenantId: "project-1",
        traceId,
        sessionId,
        occurredAtMs,
      });
      await repositories.traceSessions.ensure(
        [
          mapping("trace-1", "session-1", 1_000),
          mapping("trace-2", "session-1", 3_000),
          mapping("trace-5", "session-1", 2_000),
          mapping("trace-3", "session-2", 5_000),
          mapping("trace-4", "session-1", 90_000),
        ],
        30,
      );

      await expect(
        repositories.traceSessions.findRecentBySessionId({
          tenantId: "project-1",
          sessionId: "session-1",
          fromMs: 0,
          toMs: 10_000,
          limit: 2,
        }),
      ).resolves.toEqual([
        mapping("trace-2", "session-1", 3_000),
        mapping("trace-5", "session-1", 2_000),
      ]);
      await expect(
        repositories.traceSessions.findRecentBySessionId({
          tenantId: "project-2",
          sessionId: "session-1",
          fromMs: 0,
          toMs: 100_000,
          limit: 10,
        }),
      ).resolves.toEqual([]);
    });
  });

  describe("when a metric series is converged", () => {
    it("totals the series by its bucket, counting a re-observed series once", async () => {
      const repositories = create();
      const series = {
        tenantId: "project-1",
        sessionId: "session-1",
        seriesId: "series-1",
        metricName: "lines",
        metricUnit: "1",
        agent: "claude_code",
        attributes: { type: "added" },
        value: 12,
        dataPointCount: 1,
        asOfUnixMs: 1_000,
      };

      await repositories.metricSeries.ensure([series], 30);
      await repositories.metricSeries.ensure([{ ...series, value: 20, asOfUnixMs: 2_000 }], 30);

      await expect(
        repositories.metricSeries.findTotalsBySessionIds({
          tenantId: "project-1",
          sessionIds: ["session-1"],
          fromMs: 0,
          toMs: 10_000,
        }),
      ).resolves.toEqual([
        { sessionId: "session-1", metricName: "lines", bucket: "added", total: 20 },
      ]);
    });
  });
  describe("when sessions are counted per day", () => {
    const DAY_MS = 24 * 60 * 60 * 1000;
    const day = Date.UTC(2026, 10, 20);
    const since = day - 7 * DAY_MS;
    const until = day + DAY_MS;
    const fold = (
      repositories: ReturnType<typeof create>,
      overrides: Parameters<typeof session>[0],
    ) => repositories.sessions.upsert(session(overrides), 30, []);
    const daily = (repositories: ReturnType<typeof create>, projectIds = ["project-1"]) =>
      repositories.sessions.findDailySessionCounts({ projectIds, since, until });

    it("counts a refolded session once, on the day of its latest start", async () => {
      const repositories = create();
      await fold(repositories, { sessionId: "a", startedAtMs: day + 3_600_000 });
      await fold(repositories, { sessionId: "a", startedAtMs: day + 3_600_000 });
      await fold(repositories, { sessionId: "moved", startedAtMs: day - 1_800_000 });
      await fold(repositories, { sessionId: "moved", startedAtMs: day + 1_800_000 });
      await fold(repositories, { sessionId: "old", startedAtMs: day - 20 * DAY_MS });

      await expect(daily(repositories)).resolves.toEqual([
        { projectId: "project-1", day, agent: "claude_code", sessions: 2, users: 1 },
      ]);
    });

    it("counts a session starting at since and leaves one starting at until out", async () => {
      const repositories = create();
      await fold(repositories, { sessionId: "at-since", startedAtMs: since });
      await fold(repositories, { sessionId: "at-until", startedAtMs: until });

      await expect(daily(repositories)).resolves.toEqual([
        { projectId: "project-1", day: since, agent: "claude_code", sessions: 1, users: 1 },
      ]);
    });

    it("splits by UTC day and agent and counts each distinct non-empty user", async () => {
      const repositories = create();
      await fold(repositories, { sessionId: "s1", startedAtMs: day, userId: "user-1" });
      await fold(repositories, { sessionId: "s2", startedAtMs: day + 1, userId: "user-2" });
      await fold(repositories, { sessionId: "s3", startedAtMs: day + 2, userId: "user-2" });
      await fold(repositories, { sessionId: "s4", startedAtMs: day + 3, userId: "" });
      await fold(repositories, { sessionId: "s5", startedAtMs: day - 1, userId: "user-1" });
      await fold(repositories, {
        sessionId: "s6",
        startedAtMs: day + 4,
        userId: "user-3",
        agent: "codex",
      });

      const counts = await daily(repositories);

      expect(counts.toSorted((a, b) => a.day - b.day || a.agent.localeCompare(b.agent))).toEqual([
        { projectId: "project-1", day: day - DAY_MS, agent: "claude_code", sessions: 1, users: 1 },
        { projectId: "project-1", day, agent: "claude_code", sessions: 4, users: 2 },
        { projectId: "project-1", day, agent: "codex", sessions: 1, users: 1 },
      ]);
    });

    it("counts a helper-thread session like any other", async () => {
      const repositories = create();
      await fold(repositories, { sessionId: "helper", startedAtMs: day, auxiliary: true });

      await expect(daily(repositories)).resolves.toEqual([
        { projectId: "project-1", day, agent: "claude_code", sessions: 1, users: 1 },
      ]);
    });

    it("keeps each asked project apart and leaves an unasked project out", async () => {
      const repositories = create();
      await fold(repositories, { tenantId: "project-1", sessionId: "s1", startedAtMs: day });
      await fold(repositories, { tenantId: "project-2", sessionId: "s1", startedAtMs: day });
      await fold(repositories, { tenantId: "project-3", sessionId: "s1", startedAtMs: day });

      const counts = await daily(repositories, ["project-1", "project-2", "project-1"]);

      expect(counts.toSorted((a, b) => a.projectId.localeCompare(b.projectId))).toEqual([
        { projectId: "project-1", day, agent: "claude_code", sessions: 1, users: 1 },
        { projectId: "project-2", day, agent: "claude_code", sessions: 1, users: 1 },
      ]);
    });

    it("answers no days when the window holds no session", async () => {
      await expect(daily(create())).resolves.toEqual([]);
    });
  });
});
