import { describe, expect, it } from "vitest";
import { AutomationTraceRecordUnavailableError } from "@langwatch/automation-server";
import {
  WorkerAutomationSettlementEvaluationReader,
  WorkerAutomationSettlementTraceReader,
} from "../worker-automation-settlement-reads.composition";

/**
 * Spec: specs/automations/worker-automation-settlement-conversion.feature
 *
 * The four reads a settled match is confirmed from, asserted at the seam rather
 * than through the pipeline. Three of them answer for real from substrates this
 * process holds; the fourth refuses, and WHICH ERROR it refuses with is the
 * whole behaviour — a plain error fails the notification, while the named one
 * degrades the digest to the fold state it already has.
 */

function clickHouse(rows: unknown[] = []) {
  const calls: Array<{ query: string; query_params?: Record<string, unknown> }> = [];

  return {
    calls,
    resolve: (async () => ({
      insert: async () => undefined,
      query: async (request: { query: string; query_params?: Record<string, unknown> }) => {
        calls.push(request);
        return { json: async () => rows };
      },
    })) as never,
  };
}

describe("given the trace reads automation settlement makes in this process", () => {
  describe("when the settled fold is asked for", () => {
    /** @scenario "A settled match reaches its recipients from this process" */
    it("reads the fold this process itself writes, at the key it wrote", async () => {
      const reads: Array<{ key: string; tenantId: string }> = [];
      const reader = WorkerAutomationSettlementTraceReader.create({
        traceSummaryStore: {
          get: async (key: string, scope: { tenantId: string }) => {
            reads.push({ key, tenantId: scope.tenantId });
            return { traceId: key } as never;
          },
        } as never,
        resolveClickHouseClient: clickHouse().resolve,
      });

      await reader.tryGetSummary({ projectId: "project-1", traceId: "trace-1" });

      expect(reads).toEqual([{ key: "trace-1", tenantId: "project-1" }]);
    });
  });

  describe("when the full record is asked for", () => {
    /** @scenario "A trace whose full record this process cannot read still notifies" */
    it("refuses as unavailable rather than as an unclassified failure", async () => {
      const reader = WorkerAutomationSettlementTraceReader.create({
        traceSummaryStore: { get: async () => null } as never,
        resolveClickHouseClient: clickHouse().resolve,
      });

      await expect(
        reader.getById({ projectId: "project-1", traceId: "trace-1" }),
      ).rejects.toBeInstanceOf(AutomationTraceRecordUnavailableError);
    });
  });

  describe("when a filter query mentions span events", () => {
    /** @scenario "A settled match reaches its recipients from this process" */
    it("reads the events from stored spans, tenant-scoped and partition-hinted", async () => {
      const ch = clickHouse([]);
      const reader = WorkerAutomationSettlementTraceReader.create({
        traceSummaryStore: { get: async () => null } as never,
        resolveClickHouseClient: ch.resolve,
      });

      await reader.deriveEvents({
        projectId: "project-1",
        traceId: "trace-1",
        occurredAtMs: 1_700_000_000_000,
      });

      // Two reads, and that is the windowed read working: the hint narrows the
      // partitions first, and an empty result falls through to the unbounded
      // scan rather than reporting a trace has no events because it is old.
      expect(ch.calls).toHaveLength(2);
      expect(ch.calls[1]!.query).not.toContain("AND StartTime BETWEEN");
      expect(ch.calls[0]!.query).toContain("WHERE TenantId = {tenantId:String}");
      expect(ch.calls[0]!.query).toContain("AND TraceId = {traceId:String}");
      expect(ch.calls[0]!.query).toContain("AND StartTime BETWEEN");
      // The events expansion runs OUTSIDE the dedup, and the dedup is argMax
      // rather than LIMIT 1 BY — a re-exported span would otherwise list its
      // events twice.
      expect(ch.calls[0]!.query).toContain("ARRAY JOIN");
      expect(ch.calls[0]!.query).toContain("argMax(\"Events.Name\", UpdatedAt)");
      expect(ch.calls[0]!.query).not.toContain("SpanAttributes");
    });

    /** @scenario "A settled match reaches its recipients from this process" */
    it("reads a trace's events once per fold version, however many matches settle", async () => {
      const ch = clickHouse([]);
      const reader = WorkerAutomationSettlementTraceReader.create({
        traceSummaryStore: { get: async () => null } as never,
        resolveClickHouseClient: ch.resolve,
      });
      const read = () =>
        reader.deriveEvents({ projectId: "project-1", traceId: "trace-1", foldVersion: 7 });

      await Promise.all([read(), read(), read()]);

      expect(ch.calls).toHaveLength(1);
    });
  });

  describe("when a filter query mentions evaluations", () => {
    /** @scenario "A settled match reaches its recipients from this process" */
    it("reads the runs through Evaluation's own repository, tenant-scoped", async () => {
      const ch = clickHouse([]);
      const reader = WorkerAutomationSettlementEvaluationReader.create({
        resolveClickHouse: ch.resolve,
        defaultRetentionDays: 90,
      });

      await reader.findRunsByTraceId({ tenantId: "project-1", traceId: "trace-1" });

      expect(ch.calls).toHaveLength(1);
      expect(ch.calls[0]!.query).toContain("TenantId = {tenantId:String}");
      expect(ch.calls[0]!.query_params).toMatchObject({
        tenantId: "project-1",
        traceId: "trace-1",
      });
    });
  });
});
