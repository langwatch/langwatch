/**
 * @vitest-environment node
 *
 * The conversation-merge read path of CodingAgentSessionService: the merged
 * summary must be COMPLETE (never silently partial) and the fan-out over
 * sibling traces must stay bounded.
 */
import { describe, expect, it } from "vitest";
import type { SeriesTotalByPointAttribute } from "~/server/app-layer/metrics/repositories/metric-data-point.repository";
import type { CodingAgentSessionRow } from "~/server/event-sourcing/pipelines/trace-processing/projections/codingAgentSession.foldProjection";
import { CodingAgentSessionService } from "../coding-agent-session.service";
import { sessionRow } from "./coding-agent-session-row.fixture";

function repoWith(rows: Map<string, CodingAgentSessionRow>) {
  let inFlight = 0;
  let maxInFlight = 0;
  const calls: string[] = [];
  return {
    calls,
    maxInFlight: () => maxInFlight,
    repository: {
      getByTraceId: async ({ traceId }: { traceId: string }) => {
        calls.push(traceId);
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        // Yield so overlapping reads actually overlap in-flight.
        await new Promise((resolve) => setImmediate(resolve));
        inFlight--;
        return rows.get(traceId) ?? null;
      },
    } as never,
  };
}

describe("CodingAgentSessionService.getByTraceId", () => {
  describe("given the membership listing omits the opened trace", () => {
    it("still merges the opened trace's own row", async () => {
      const rows = new Map([
        ["trace-own", sessionRow({ traceId: "trace-own", modelCalls: 5 })],
        ["trace-sib", sessionRow({ traceId: "trace-sib", modelCalls: 3 })],
      ]);
      const { repository, calls } = repoWith(rows);
      const service = new CodingAgentSessionService(repository, {
        // A truncated or ingestion-lagged listing that misses the very trace
        // the user has open.
        listConversationTraces: async () => [
          { traceId: "trace-sib", startedAtMs: 500 },
        ],
      });

      const merged = await service.getByTraceId({
        projectId: "project_1",
        traceId: "trace-own",
        startedAtMs: 1_000,
        conversationId: "conv-1",
      });

      expect(calls).toContain("trace-own");
      expect(merged?.modelCalls).toBe(8);
      expect(merged?.traceIds).toContain("trace-own");
    });
  });

  describe("given a session spanning many sibling traces", () => {
    it("reads every sibling but never more than the concurrency bound at once", async () => {
      const siblingCount = 47;
      const rows = new Map(
        Array.from({ length: siblingCount }, (_, i) => {
          const traceId = `trace-${i}`;
          return [
            traceId,
            sessionRow({ traceId, startedAtMs: i, modelCalls: 1 }),
          ] as const;
        }),
      );
      const { repository, calls, maxInFlight } = repoWith(rows);
      const service = new CodingAgentSessionService(repository, {
        listConversationTraces: async () =>
          Array.from({ length: siblingCount }, (_, i) => ({
            traceId: `trace-${i}`,
            startedAtMs: i,
          })),
      });

      const merged = await service.getByTraceId({
        projectId: "project_1",
        traceId: "trace-0",
        conversationId: "conv-1",
      });

      expect(calls.length).toBe(siblingCount);
      expect(maxInFlight()).toBeLessThanOrEqual(10);
      expect(merged?.modelCalls).toBe(siblingCount);
    });
  });

  describe("given no trace in the conversation has a session row", () => {
    it("returns null", async () => {
      const { repository } = repoWith(new Map());
      const service = new CodingAgentSessionService(repository, {
        listConversationTraces: async () => [
          { traceId: "trace-a", startedAtMs: 1 },
        ],
      });

      const merged = await service.getByTraceId({
        projectId: "project_1",
        traceId: "trace-a",
        conversationId: "conv-1",
      });

      expect(merged).toBeNull();
    });
  });

  describe("given session-keyed metric totals exist", () => {
    it("fills the metric-only fields, and never overwrites what the fold saw", async () => {
      const rows = new Map([
        [
          "trace-a",
          sessionRow({
            traceId: "trace-a",
            sessionId: "sess-1",
            modelCalls: 5,
            // The fold already counted commits from somewhere; the metric
            // overlay must not stomp it.
            commits: 2,
          }),
        ],
      ]);
      const { repository } = repoWith(rows);
      const service = new CodingAgentSessionService(repository, {
        listConversationTraces: async () => [
          { traceId: "trace-a", startedAtMs: 1_000 },
        ],
        getSessionMetricTotals: async (): Promise<
          SeriesTotalByPointAttribute[]
        > => [
          {
            metricName: "claude_code.lines_of_code.count",
            total: 120,
            pointAttributes: { "session.id": "sess-1", type: "added" },
          },
          {
            metricName: "claude_code.lines_of_code.count",
            total: 30,
            pointAttributes: { "session.id": "sess-1", type: "removed" },
          },
          {
            metricName: "claude_code.commit.count",
            total: 7,
            pointAttributes: { "session.id": "sess-1" },
          },
          {
            metricName: "claude_code.active_time.total",
            total: 300,
            pointAttributes: { "session.id": "sess-1", type: "user" },
          },
        ],
      });

      const merged = await service.getByTraceId({
        projectId: "project_1",
        traceId: "trace-a",
        conversationId: "conv-1",
      });

      expect(merged?.linesAdded).toBe(120);
      expect(merged?.linesRemoved).toBe(30);
      expect(merged?.activeTimeUserSec).toBe(300);
      expect(merged?.commits).toBe(2);
    });

    it("keeps the session when the metric read fails", async () => {
      const rows = new Map([
        ["trace-a", sessionRow({ traceId: "trace-a", sessionId: "sess-1" })],
      ]);
      const { repository } = repoWith(rows);
      const service = new CodingAgentSessionService(repository, {
        listConversationTraces: async () => [
          { traceId: "trace-a", startedAtMs: 1_000 },
        ],
        getSessionMetricTotals: async () => {
          throw new Error("clickhouse down");
        },
      });

      const merged = await service.getByTraceId({
        projectId: "project_1",
        traceId: "trace-a",
        conversationId: "conv-1",
      });

      expect(merged?.traceId).toBe("trace-a");
    });
  });
});
