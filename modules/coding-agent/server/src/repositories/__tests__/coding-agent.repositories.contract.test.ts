/**
 * @vitest-environment node
 * The contract of the four rows the coding-agent module owns, stated once and
 * run against every backend the package can reach. The memory twin runs
 * always; the ClickHouse tier joins the table where an endpoint is declared.
 */
import { describe, expect, it } from "vitest";
import { MemoryCodingAgentRepositories } from "../memory/memory.coding-agent.repositories.ts";
import type { CodingAgentRepositories } from "../coding-agent.repositories.ts";
import { session, sessionEventRecord } from "../../__tests__/fixtures/coding-agent.fixture.ts";

const backends: ReadonlyArray<{ name: string; create: () => CodingAgentRepositories }> = [
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

      const page = await repositories.sessionEvents.findBySessionId({
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
});
