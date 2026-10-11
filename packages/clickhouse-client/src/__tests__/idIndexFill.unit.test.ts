/**
 * The id-index fill's batch walk, cursor and back-off, over the real client and a driver spy.
 * Spec: specs/clickhouse/id-index-reads.feature
 */
import { describe, expect, it, vi } from "vitest";

import { ClickHouseQueryClient } from "../client.ts";
import {
  fillIdIndexes,
  fillOwnerIdIndexes,
  fillStatement,
  type IdIndexDeclaration,
  type IdIndexFillReport,
  idIndexFillTargets,
  planBatches,
} from "../idIndexFill.ts";
import type { QueryDriver, QueryRequest } from "../query.ts";
import { TenantGuard } from "../tenantGuard.ts";

const SPANS: IdIndexDeclaration = {
  source: "stored_spans",
  index: "stored_spans_id_index",
  key: ["TraceId"],
  time: "StartTime",
  retentionAnchor: "StartTime",
  retention: "copied",
};

/** Two weekly partitions: a small one, and one split into two tenant ranges at 20 rows. */
function serverWith({ failFirstBatches }: { failFirstBatches: number }) {
  const execute = vi.fn<QueryDriver["execute"]>().mockImplementation(async (request) => {
    if (request.sql.includes("system.parts")) {
      return {
        rows: [
          { partition_id: "202641", rows: "10" },
          { partition_id: "202640", rows: "30" },
        ],
      };
    }
    return {
      rows: [
        { TenantId: "tenant_a", rows: "10" },
        { TenantId: "tenant_b", rows: "15" },
        { TenantId: "tenant_c", rows: "5" },
      ],
    };
  });
  const command = vi.fn<QueryDriver["command"]>().mockResolvedValue(undefined);
  for (let failure = 0; failure < failFirstBatches; failure += 1) {
    command.mockRejectedValueOnce(new Error("Code: 159. Timeout exceeded"));
  }
  const client = new ClickHouseQueryClient({
    driver: { execute, insert: async () => {}, command },
    tenantGuard: new TenantGuard(),
  });
  const requests = (): QueryRequest[] => command.mock.calls.map(([request]) => request);
  const batches = (): Record<string, unknown>[] =>
    requests()
      .filter((request) => request.params?.marker === undefined)
      .map((request) => ({
        partition: request.params?.partition,
        afterTenantId: request.params?.afterTenantId,
        throughTenantId: request.params?.throughTenantId,
      }));
  const markers = (): string[] =>
    requests()
      .filter((request) => request.params?.marker !== undefined)
      .map((request) => request.organizationId ?? "shared");
  return { client, batches, markers };
}

/** The ledger's checkpoint, in memory: the last saved report and every save. */
function checkpointFrom(resumeFrom: IdIndexFillReport | null) {
  const saved: IdIndexFillReport[] = [];
  return {
    saved,
    checkpoint: {
      resumeFrom,
      save: async ({ report }: { report: IdIndexFillReport }) => {
        saved.push(structuredClone(report));
      },
    },
  };
}

describe("fillIdIndexes", () => {
  describe("given a backfill whose next batch fails twice and then succeeds", () => {
    /** @scenario "a failed batch backs off and resumes from its cursor" */
    it("retries after a growing pause, and after a restart resumes from the last committed batch", async () => {
      const first = serverWith({ failFirstBatches: 2 });
      const firstRun = checkpointFrom(null);
      const pauses: number[] = [];
      const stop = new AbortController();
      const options = {
        targets: idIndexFillTargets({ privateRoutes: new Map() }),
        indexes: [SPANS],
        batchRows: 20,
        beforeMarker: async () => {},
        sleep: async (ms: number) => {
          pauses.push(ms);
        },
      };

      await fillIdIndexes({
        ...options,
        statements: first.client,
        checkpoint: {
          ...firstRun.checkpoint,
          save: async (args) => {
            await firstRun.checkpoint.save(args);
            // The process dies after the second committed batch.
            if (args.report.batches === 2) stop.abort();
          },
        },
        signal: stop.signal,
      });

      expect(pauses).toEqual([1_000, 2_000]);
      expect(first.batches()).toEqual([
        { partition: "202641", afterTenantId: "", throughTenantId: undefined },
        { partition: "202641", afterTenantId: "", throughTenantId: undefined },
        { partition: "202641", afterTenantId: "", throughTenantId: undefined },
        { partition: "202640", afterTenantId: "", throughTenantId: "tenant_a" },
      ]);
      expect(first.markers()).toEqual([]);

      const second = serverWith({ failFirstBatches: 0 });
      const resumed = checkpointFrom(firstRun.saved.at(-1) ?? null);
      const report = await fillIdIndexes({
        ...options,
        statements: second.client,
        checkpoint: resumed.checkpoint,
        signal: new AbortController().signal,
      });

      expect(second.batches()).toEqual([
        { partition: "202640", afterTenantId: "tenant_a", throughTenantId: "tenant_c" },
      ]);
      expect(second.markers()).toEqual(["shared"]);
      expect(report).toMatchObject({
        targetsDone: ["shared"],
        cursor: null,
        batches: 3,
        retries: 2,
      });
    });
  });

  describe("given a batch that fails on every attempt", () => {
    it("records the target as failed, carries on, and throws at the end", async () => {
      const server = serverWith({ failFirstBatches: 100 });
      const { saved, checkpoint } = checkpointFrom(null);

      await expect(
        fillIdIndexes({
          statements: server.client,
          targets: idIndexFillTargets({ privateRoutes: new Map() }),
          indexes: [SPANS],
          checkpoint,
          signal: new AbortController().signal,
          beforeMarker: async () => {},
          sleep: async () => {},
        }),
      ).rejects.toMatchObject({ name: "IdIndexFillIncompleteError" });
      expect(saved.at(-1)?.targetsFailed.map((each) => each.target)).toEqual(["shared"]);
    });
  });

  describe("given a target whose batches time out at every size", () => {
    /** @scenario "a batch that times out is halved, and a stuck target does not stop the others" */
    it("halves the batch on code 159 down to the floor, fails that target and fills the next", async () => {
      const attempts: { target: string; throughTenantId: unknown }[] = [];
      const statements = {
        query: async <Row>(request: QueryRequest) => {
          if (request.table === "system.parts") {
            return { rows: [{ partition_id: "202641", rows: "40" }] as Row[] };
          }
          return {
            rows: [
              { TenantId: "tenant_a", rows: "10" },
              { TenantId: "tenant_b", rows: "15" },
              { TenantId: "tenant_c", rows: "15" },
            ] as Row[],
          };
        },
        command: async (request: QueryRequest) => {
          if (request.params?.marker !== undefined) return;
          const target = request.organizationId ?? "shared";
          attempts.push({ target, throughTenantId: request.params?.throughTenantId });
          if (target === "shared") {
            throw Object.assign(new Error("Timeout exceeded: elapsed 600 s"), { code: "159" });
          }
        },
      };
      const { saved, checkpoint } = checkpointFrom(null);

      await expect(
        fillIdIndexes({
          statements,
          targets: idIndexFillTargets({ privateRoutes: new Map([["org_p", "http://p"]]) }),
          indexes: [SPANS],
          batchRows: 40,
          minBatchRows: 10,
          checkpoint,
          signal: new AbortController().signal,
          beforeMarker: async () => {},
          sleep: async () => {},
        }),
      ).rejects.toMatchObject({ name: "IdIndexFillIncompleteError" });

      const shared = attempts.filter((each) => each.target === "shared");
      // 40 rows whole, then 20 (tenant_a alone), then the 10-row floor until its retries run out.
      expect(shared.map((each) => each.throughTenantId)).toEqual([
        undefined,
        "tenant_a",
        ...Array.from({ length: 5 }, () => "tenant_a"),
      ]);
      expect(attempts.filter((each) => each.target === "org_p")).toHaveLength(1);
      expect(saved.at(-1)).toMatchObject({
        targetsDone: ["org_p"],
        targetsFailed: [{ target: "shared" }],
      });
    });
  });

  describe("given a partition whose parts live on the cold volume", () => {
    it("starts it at a quarter of the batch", async () => {
      const through: unknown[] = [];
      const statements = {
        query: async <Row>(request: QueryRequest) => {
          if (request.table === "system.parts") {
            return { rows: [{ partition_id: "202601", rows: "40", cold: 1 }] as Row[] };
          }
          return {
            rows: [
              { TenantId: "tenant_a", rows: "10" },
              { TenantId: "tenant_b", rows: "30" },
            ] as Row[],
          };
        },
        command: async (request: QueryRequest) => {
          if (request.params?.marker === undefined) through.push(request.params?.throughTenantId);
        },
      };

      await fillIdIndexes({
        statements,
        targets: idIndexFillTargets({ privateRoutes: new Map() }),
        indexes: [SPANS],
        batchRows: 40,
        minBatchRows: 1,
        checkpoint: checkpointFrom(null).checkpoint,
        signal: new AbortController().signal,
        beforeMarker: async () => {},
      });

      expect(through).toEqual(["tenant_a", "tenant_b", "tenant_b", "tenant_b"]);
    });
  });

  describe("given an owner's fill over the shared target and a private one", () => {
    it("raises each target's copied-retention indexes before it writes that target's markers", async () => {
      const order: string[] = [];
      const statements = {
        query: async <Row>(request: QueryRequest) => {
          if (request.table === "system.parts") return { rows: [] as Row[] };
          return { rows: [] as Row[] };
        },
        command: async (request: QueryRequest) => {
          order.push(`marker ${request.table} ${request.organizationId ?? "shared"}`);
        },
        privateRoutes: () => new Map([["org_private", "http://private"]]),
      };

      await fillOwnerIdIndexes({
        clickhouse: statements,
        indexes: [SPANS, { ...SPANS, index: "spans_forever_id_index", retention: "none" }],
        checkpoint: checkpointFrom(null).checkpoint,
        signal: new AbortController().signal,
        raiseRetention: async (input) => {
          order.push(`raise ${JSON.stringify(input)}`);
        },
      });

      expect(order).toEqual([
        'raise {"indexes":["stored_spans_id_index"]}',
        "marker stored_spans_id_index shared",
        "marker spans_forever_id_index shared",
        'raise {"organizationId":"org_private","indexes":["stored_spans_id_index"]}',
        "marker stored_spans_id_index org_private",
        "marker spans_forever_id_index org_private",
      ]);
    });
  });

  describe("when batches are planned", () => {
    it("gives a tenant larger than a batch its own hash slices", () => {
      expect(
        planBatches({
          partition: { partition: "p", rows: 50 },
          tenants: [
            { tenantId: "a", rows: 5 },
            { tenantId: "b", rows: 45 },
          ],
          batchRows: 20,
        }),
      ).toEqual([
        { afterTenantId: "", throughTenantId: "a", slice: 0, slices: 1 },
        { afterTenantId: "a", throughTenantId: "b", slice: 0, slices: 3 },
        { afterTenantId: "a", throughTenantId: "b", slice: 1, slices: 3 },
        { afterTenantId: "a", throughTenantId: "b", slice: 2, slices: 3 },
      ]);
    });

    it("writes RetainAt and a fixed forever retention where the declaration asks", () => {
      const { sql } = fillStatement({
        index: { ...SPANS, retentionAnchor: "UpdatedAt", retention: "none" },
        batch: { afterTenantId: "", throughTenantId: null, slice: 0, slices: 1 },
      });
      expect(sql).toBe(
        "INSERT INTO stored_spans_id_index (TenantId, TraceId, FromAt, ToAt, RetainAt, _retention_days) " +
          "SELECT TenantId, TraceId, min(StartTime) AS FromAt, max(StartTime) AS ToAt, " +
          "max(UpdatedAt) AS RetainAt, max(toUInt16(65535)) AS _retention_days FROM stored_spans " +
          "WHERE _partition_id = {partition:String} AND TenantId > {afterTenantId:String} " +
          "GROUP BY TenantId, TraceId",
      );
    });

    it("visits each private URL once, routed by its first organisation", () => {
      expect(
        idIndexFillTargets({
          privateRoutes: new Map([
            ["org_b", "http://one"],
            ["org_a", "http://one"],
            ["org_c", "http://two"],
          ]),
        }),
      ).toEqual([
        { key: "shared" },
        { key: "org_a", organizationId: "org_a" },
        { key: "org_c", organizationId: "org_c" },
      ]);
    });
  });
});
