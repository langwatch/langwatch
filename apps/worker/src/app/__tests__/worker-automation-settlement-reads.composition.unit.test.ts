import { describe, expect, it } from "vitest";
import { AutomationTraceRecordUnavailableError } from "@langwatch/automation-server";
import { TraceNotFoundError } from "@langwatch/trace-contract";
import { TraceCanonicalisationService } from "@langwatch/trace-server";
import { WorkerAutomationSettlementAbsenceReportPort } from "../worker-automation-settlement.composition";
import {
  WorkerAutomationSettlementEvaluationReader,
  WorkerAutomationSettlementTraceReader,
  WorkerTraceRecordReader,
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

/** One project's resolved policy, with every category captured. */
function openPolicy() {
  return {
    getResolvedForProject: async () => ({
      categories: {
        input: { disposition: "capture", audience: {} },
        output: { disposition: "capture", audience: {} },
        system: { disposition: "capture", audience: {} },
        tools: { disposition: "capture", audience: {} },
      },
      customAttributes: [],
    }),
  } as never;
}

function recordReader(resolve: ReturnType<typeof clickHouse>["resolve"]) {
  return WorkerTraceRecordReader.create({
    // The packaged read declares the generated client by type and reads no row
    // through it on this path, so the double carries no delegate.
    connection: { client: {} } as never,
    resolveClickHouseClient: resolve,
    dataPrivacy: openPolicy(),
    traceCanonicalisation: TraceCanonicalisationService.create(),
  });
}

function recordingAbsence(into: string[]) {
  return new (class extends WorkerAutomationSettlementAbsenceReportPort {
    withoutLegacyFilterMatching(): void {}
    withoutTraceRecordRead(): void {
      into.push("traceRecordRead");
    }
    withoutDatasetPersist(): void {}
    withoutAnnotationQueuePersist(): void {}
    withoutRunawayContainment(): void {}
    withoutPlanResolvedPersistCap(): void {}
    withoutGraphAlertEvaluation(): void {}
    withoutNotificationDelivery(): void {}
  })();
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

  describe("when the full record is asked for and this graph holds no typed client", () => {
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

    /** @scenario "A trace whose full record this process cannot read still notifies" */
    it("names the missing read once at composition rather than at the first digest", () => {
      const absences: string[] = [];
      WorkerAutomationSettlementTraceReader.create({
        traceSummaryStore: { get: async () => null } as never,
        resolveClickHouseClient: clickHouse().resolve,
        absence: recordingAbsence(absences),
      });

      expect(absences).toEqual(["traceRecordRead"]);
    });
  });

  describe("when the full record is asked for and the read is composed", () => {
    /** @scenario "The worker reads a settled trace's full record for itself" */
    it("declares nothing absent", () => {
      const absences: string[] = [];
      WorkerAutomationSettlementTraceReader.create({
        traceSummaryStore: { get: async () => null } as never,
        resolveClickHouseClient: clickHouse().resolve,
        records: recordReader(clickHouse().resolve),
        absence: recordingAbsence(absences),
      });

      expect(absences).toEqual([]);
    });

    /**
     * The read really runs: a trace this project does not hold comes back as
     * GONE rather than as "no reader here", and those two answers are treated
     * differently by every caller — one degrades a digest entry, the other is a
     * permanent property of the composition.
     */
    /** @scenario "The worker reads a settled trace's full record for itself" */
    it("answers not-found for a trace ClickHouse does not hold, tenant-scoped", async () => {
      const ch = clickHouse([]);
      const reader = WorkerAutomationSettlementTraceReader.create({
        traceSummaryStore: { get: async () => null } as never,
        resolveClickHouseClient: ch.resolve,
        records: recordReader(ch.resolve),
      });

      const read = reader.getById({ projectId: "project-1", traceId: "trace-1" });

      await expect(read).rejects.toBeInstanceOf(TraceNotFoundError);
      await expect(read).rejects.not.toBeInstanceOf(AutomationTraceRecordUnavailableError);
      expect(ch.calls.length).toBeGreaterThan(0);
      for (const call of ch.calls) {
        expect(call.query).toContain("TenantId = {tenantId:String}");
        expect(call.query_params).toMatchObject({ tenantId: "project-1" });
      }
    });

    /**
     * The redactions are the project's own policy, and an unresolvable policy
     * must not fail the read — it must hide content and say so. A read that
     * threw here would turn a privacy-store blip into a dead-lettered match.
     */
    /** @scenario "The worker reads a settled trace's full record for itself" */
    it("hides captured content and keeps reading when the policy cannot resolve", async () => {
      const errors: Array<Record<string, unknown>> = [];
      const ch = clickHouse([]);
      const reader = WorkerTraceRecordReader.create({
        connection: { client: {} } as never,
        resolveClickHouseClient: ch.resolve,
        dataPrivacy: {
          getResolvedForProject: async () => {
            throw new Error("privacy store unreachable");
          },
        } as never,
        traceCanonicalisation: TraceCanonicalisationService.create(),
        logger: {
          error: (fields: Record<string, unknown>) => errors.push(fields),
          warn: () => undefined,
          info: () => undefined,
          debug: () => undefined,
        } as never,
      });

      await expect(
        reader.getById({ projectId: "project-1", traceId: "trace-1" }),
      ).rejects.toBeInstanceOf(TraceNotFoundError);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatchObject({ projectId: "project-1" });
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
      expect(ch.calls[0]!.query).toContain('argMax("Events.Name", UpdatedAt)');
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
