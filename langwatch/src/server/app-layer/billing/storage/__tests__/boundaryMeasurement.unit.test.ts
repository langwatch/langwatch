import { describe, expect, it, vi } from "vitest";

import { BoundaryMeasurementService } from "../boundaryMeasurement.service";
import type { AppendBoundaryEventInput } from "../repositories/storage-boundary-event.repository";

const DAY_MS = 24 * 60 * 60 * 1000;

// 2026-07-10 00:20 → whole-day cutoff 2026-06-05 00:00; the newest complete
// slice is Thursday 2026-06-04 → partition start Sunday 2026-05-31.
const at = new Date(Date.UTC(2026, 6, 10, 0, 20));
const expectedSlice = new Date(Date.UTC(2026, 5, 4));

/** Fake CH client returning canned per-table rows. */
function fakeClient(rowsByTable: Record<string, unknown[]>) {
  const queries: { query: string; query_params: Record<string, unknown> }[] =
    [];
  return {
    queries,
    client: {
      query: vi.fn(async (params: any) => {
        queries.push(params);
        const table = /FROM (\w+)/.exec(params.query)?.[1] ?? "";
        return { json: async () => rowsByTable[table] ?? [] };
      }),
    },
  };
}

function makeService({
  rowsByTable,
  prior = [],
  retentionMutationInFlight = false,
}: {
  rowsByTable: Record<string, unknown[]>;
  prior?: { category: string; retentionDays: number; totalBytes: bigint }[];
  retentionMutationInFlight?: boolean;
}) {
  const { client, queries } = fakeClient(rowsByTable);
  const appended: AppendBoundaryEventInput[] = [];
  const service = new BoundaryMeasurementService({
    resolveClickHouseClient: async () => client as any,
    events: {
      append: vi.fn(async (input: AppendBoundaryEventInput) => {
        appended.push(input);
        return { applied: true };
      }),
      findAllByOrganization: vi.fn(async () => []),
      sumNonExitByPartition: vi.fn(async () => prior),
      sumLiveNetGroups: vi.fn(async () => []),
      countEventsAfter: vi.fn(async () => 0),
    },
    listProjectIds: async () => ["project_1"],
    hasInFlightRetentionMutation: async () => retentionMutationInFlight,
  });
  return { service, appended, queries };
}

describe("BoundaryMeasurementService", () => {
  describe("when a slice with 63-day retention crosses the billable line", () => {
    it("emits an entry event with the measured bytes", async () => {
      const { service, appended } = makeService({
        rowsByTable: {
          stored_spans: [{ retentionDays: 63, bytes: "1000" }],
        },
      });
      await service.measureEntriesForOrg({ organizationId: "org_1", at });

      expect(appended).toEqual([
        expect.objectContaining({
          edge: "ENTRY",
          category: "traces",
          retentionDays: 63,
          deltaBytes: 1000n,
          partitionKey: "2026-05-31",
          sliceDate: expectedSlice,
          occurredAt: new Date(expectedSlice.getTime() + 35 * DAY_MS),
        }),
      ]);
    });
  });

  describe("when part of the measurement was already recorded on a prior day", () => {
    it("emits only the cumulative-minus-prior delta", async () => {
      const { service, appended } = makeService({
        rowsByTable: {
          stored_spans: [{ retentionDays: 63, bytes: "1000" }],
        },
        prior: [{ category: "traces", retentionDays: 63, totalBytes: 900n }],
      });
      await service.measureEntriesForOrg({ organizationId: "org_1", at });

      expect(appended.map((e) => e.deltaBytes)).toEqual([100n]);
    });
  });

  describe("when the measurement matches the recorded prior exactly", () => {
    it("emits nothing", async () => {
      const { service, appended } = makeService({
        rowsByTable: {
          stored_spans: [{ retentionDays: 63, bytes: "900" }],
        },
        prior: [{ category: "traces", retentionDays: 63, totalBytes: 900n }],
      });
      await service.measureEntriesForOrg({ organizationId: "org_1", at });

      expect(appended).toEqual([]);
    });
  });

  describe("when rows carry retention at or under the billable window", () => {
    it("never bills them (they die before day 35)", async () => {
      const { service, appended } = makeService({
        rowsByTable: {
          stored_spans: [
            { retentionDays: 30, bytes: "1000" },
            { retentionDays: 35, bytes: "1000" },
          ],
        },
      });
      await service.measureEntriesForOrg({ organizationId: "org_1", at });

      expect(appended).toEqual([]);
    });
  });

  describe("when rows carry indefinite retention (0 = keep forever)", () => {
    it("bills them", async () => {
      const { service, appended } = makeService({
        rowsByTable: {
          stored_spans: [{ retentionDays: 0, bytes: "500" }],
        },
      });
      await service.measureEntriesForOrg({ organizationId: "org_1", at });

      expect(appended.map((e) => e.retentionDays)).toEqual([0]);
    });
  });

  describe("when two tables of the same category both have crossing bytes", () => {
    it("emits one event with the pre-summed category total", async () => {
      const { service, appended } = makeService({
        rowsByTable: {
          stored_spans: [{ retentionDays: 63, bytes: "600" }],
          trace_summaries: [{ retentionDays: 63, bytes: "400" }],
        },
      });
      await service.measureEntriesForOrg({ organizationId: "org_1", at });

      expect(appended.map((e) => e.deltaBytes)).toEqual([1000n]);
    });
  });

  describe("when the sweep runs daily in steady state", () => {
    it("measures exactly one partition (whole slices, one event per slice)", async () => {
      const { service, queries } = makeService({ rowsByTable: {} });
      await service.measureEntriesForOrg({
        organizationId: "org_1",
        at,
        sinceDay: new Date(Date.UTC(2026, 6, 9)), // yesterday
      });

      const starts = new Set(
        queries.map((q) => (q.query_params.partitionStart as Date).getTime()),
      );
      expect([...starts]).toEqual([Date.UTC(2026, 4, 31)]);
    });
  });

  describe("when missed days cross a partition boundary", () => {
    it("measures every partition a missed slice falls into", async () => {
      // at 2026-07-13: slice = Jun 6 (Sat, partition May 31). Last entry
      // sweep ran Jul 10 (its cutoff covered through Jun 4) — the missed
      // slices Jun 4..Jun 6 stay in partition May 31, but running one more
      // day later (Jul 14 → slice Jun 7, Sunday) must ALSO re-measure the
      // May 31 partition or its tail would be stranded.
      const { service, queries } = makeService({ rowsByTable: {} });
      await service.measureEntriesForOrg({
        organizationId: "org_1",
        at: new Date(Date.UTC(2026, 6, 14, 0, 20)),
        sinceDay: new Date(Date.UTC(2026, 6, 10)),
      });

      const starts = new Set(
        queries.map((q) => (q.query_params.partitionStart as Date).getTime()),
      );
      expect([...starts].sort()).toEqual([
        Date.UTC(2026, 4, 31),
        Date.UTC(2026, 5, 7),
      ]);
    });
  });

  describe("when a retention mutation is in flight for the project", () => {
    it("skips measurement so the reverse-then-emit re-book is not measured back in", async () => {
      // Post reverse-then-emit (63→91): the event log has reversed the old
      // 63 group to net zero, but ClickHouse still carries the old 63 label
      // because the ALTER mutation has not landed. Measuring now would see
      // full 63 bytes vs a zero prior and emit a phantom 63 ENTRY — the
      // over-count the reviewer flagged. The in-flight guard prevents it.
      const { service, appended, queries } = makeService({
        rowsByTable: {
          stored_spans: [{ retentionDays: 63, bytes: "1000" }],
        },
        prior: [{ category: "traces", retentionDays: 63, totalBytes: 0n }],
        retentionMutationInFlight: true,
      });

      await service.measureEntriesForOrg({ organizationId: "org_1", at });

      expect(appended).toEqual([]);
      // Skipped before any _size_bytes read (in production the in-flight
      // predicate itself does one cheap system.mutations lookup).
      expect(queries).toEqual([]);
    });

    it("measures normally once the mutation has landed", async () => {
      const { service, appended } = makeService({
        rowsByTable: {
          stored_spans: [{ retentionDays: 91, bytes: "1000" }],
        },
        retentionMutationInFlight: false,
      });

      await service.measureEntriesForOrg({ organizationId: "org_1", at });

      expect(appended.map((e) => e.retentionDays)).toEqual([91]);
    });
  });

  describe("when every _size_bytes query runs", () => {
    it("carries the mandatory OOM caps and a single-partition range predicate", async () => {
      const { service, queries } = makeService({ rowsByTable: {} });
      await service.measureEntriesForOrg({ organizationId: "org_1", at });

      for (const q of queries as any[]) {
        expect(q.clickhouse_settings).toEqual({
          max_threads: 2,
          max_execution_time: 45,
        });
        expect(q.query).toMatch(/TenantId = \{tenantId:String\}/);
        expect(q.query).toMatch(/>= \{partitionStart:DateTime64\(3\)\}/);
        expect(q.query).toMatch(/< \{partitionEnd:DateTime64\(3\)\}/);
        expect(q.query).toMatch(/< \{cutoff:DateTime64\(3\)\}/);
      }
      expect(
        (queries[0] as any).query_params.partitionEnd.getTime() -
          (queries[0] as any).query_params.partitionStart.getTime(),
      ).toEqual(7 * DAY_MS);
    });
  });
});
