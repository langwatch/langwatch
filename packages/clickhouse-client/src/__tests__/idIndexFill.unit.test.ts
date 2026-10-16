/**
 * The id-index fill's batch walk, cursor and back-off, over the real client and a driver spy.
 * Spec: specs/clickhouse/id-index-reads.feature
 */
import { describe, expect, it, vi } from "vitest";

import { ClickHouseQueryClient } from "../client.ts";
import {
  defineIdIndex,
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
  return { client, requests, batches, markers };
}

/** One tenant's 23 span rows over 9 traces in one partition, as the source sorts them. */
const traces = ["t1", "t2", "t3", "t4", "t5", "t6", "t7", "t8", "t9"];
const rows = traces.flatMap((traceId, position) =>
  Array.from({ length: position % 2 === 0 ? 3 : 2 }, () => traceId),
);

/** Answers the fill's reads from `rows`, and counts each source row an insert reads. */
function sortedServer() {
  let rowsRead = 0;
  const indexed = new Set<string>();
  const inRange = (traceId: string, params: Record<string, unknown> | undefined) => {
    const after = params?.afterKey0;
    const through = params?.throughKey0;
    return (
      (typeof after !== "string" || traceId > after) &&
      (typeof through !== "string" || traceId <= through)
    );
  };
  const execute = vi.fn<QueryDriver["execute"]>().mockImplementation(async (request) => {
    if (request.sql.includes("system.parts")) {
      return { rows: [{ partition_id: "202641", rows: String(rows.length) }] };
    }
    if (request.sql.includes("system.tables")) {
      return { rows: [{ sorting_key: "TenantId, TraceId, SpanId" }] };
    }
    if (request.sql.includes("GROUP BY TenantId ORDER BY TenantId")) {
      return { rows: [{ TenantId: "tenant_big", rows: String(rows.length) }] };
    }
    const offset = Number(/OFFSET (\d+)/.exec(request.sql)?.[1]);
    const after = request.params?.afterKey0;
    const remaining = rows.filter((traceId) => typeof after !== "string" || traceId > after);
    const found = remaining[offset];
    return { rows: found === undefined ? [] : [{ TraceId: found }] };
  });
  const command = vi.fn<QueryDriver["command"]>().mockImplementation(async (request) => {
    if (request.params?.marker !== undefined) return;
    expect(request.sql).not.toContain("cityHash64");
    for (const traceId of rows.filter((each) => inRange(each, request.params))) {
      rowsRead += 1;
      indexed.add(traceId);
    }
  });
  const client = new ClickHouseQueryClient({
    driver: { execute, insert: async () => {}, command },
    tenantGuard: new TenantGuard(),
  });
  return { client, rowsRead: () => rowsRead, indexed };
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

  describe("given a walk stopped right after a partition finished", () => {
    it("resumes past that partition and counts it once", async () => {
      const first = serverWith({ failFirstBatches: 0 });
      const stop = new AbortController();
      const options = {
        targets: idIndexFillTargets({ privateRoutes: new Map() }),
        indexes: [SPANS],
        batchRows: 20,
        beforeMarker: async () => {},
        sleep: async () => {},
      };

      // The small partition is one batch; the process stops as it commits.
      const stopped = await fillIdIndexes({
        ...options,
        statements: first.client,
        checkpoint: {
          resumeFrom: null,
          save: async ({ report }) => {
            if (report.batches === 1) stop.abort();
          },
        },
        signal: stop.signal,
      });

      expect(stopped).toMatchObject({ done: 1, total: 2 });

      const second = serverWith({ failFirstBatches: 0 });
      const report = await fillIdIndexes({
        ...options,
        statements: second.client,
        checkpoint: checkpointFrom(structuredClone(stopped)).checkpoint,
        signal: new AbortController().signal,
      });

      expect(second.batches().map((batch) => batch.partition)).toEqual(["202640", "202640"]);
      expect(report).toMatchObject({ done: 2, total: 2, targetsDone: ["shared"] });
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

    /** @scenario "a fill retried after a failed first batch counts each partition once" */
    it("counts the target's partitions once however often the ledger retries it", async () => {
      const run = async (resumeFrom: IdIndexFillReport | null) => {
        const server = serverWith({ failFirstBatches: 100 });
        const { saved, checkpoint } = checkpointFrom(resumeFrom);
        await fillIdIndexes({
          statements: server.client,
          targets: idIndexFillTargets({ privateRoutes: new Map() }),
          indexes: [SPANS],
          checkpoint,
          signal: new AbortController().signal,
          beforeMarker: async () => {},
          sleep: async () => {},
        }).catch(() => undefined);
        return saved.at(-1) ?? null;
      };

      const first = await run(null);
      const retried = await run(await run(first));

      expect(first?.total).toBe(2);
      expect(retried?.total).toBe(2);
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

  describe("given two indexes on one source, by different keys", () => {
    const RUNS = defineIdIndex({ source: "experiment_runs", key: ["RunId"], time: "StartedAt" });
    const RUNS_BY_EXPERIMENT = defineIdIndex({
      source: "experiment_runs",
      key: ["ExperimentId"],
      time: "StartedAt",
      by: true,
    });

    it("fills each, raises both and writes each one's marker", async () => {
      const server = serverWith({ failFirstBatches: 0 });
      const raised: string[][] = [];

      await fillOwnerIdIndexes({
        clickhouse: server.client,
        indexes: [RUNS, RUNS_BY_EXPERIMENT],
        checkpoint: checkpointFrom(null).checkpoint,
        signal: new AbortController().signal,
        raiseRetention: async ({ indexes }) => {
          raised.push(indexes);
        },
      });

      const filled = (index: string) =>
        server
          .requests()
          .filter((request) => request.sql.startsWith(`INSERT INTO ${index} (TenantId, `))
          .filter((request) => request.params?.marker === undefined);
      expect(filled("experiment_runs_id_index")).toHaveLength(2);
      expect(filled("experiment_runs_by_experiment_id_index")).toHaveLength(2);
      expect(raised).toEqual([
        ["experiment_runs_id_index", "experiment_runs_by_experiment_id_index"],
      ]);
      expect(
        server
          .requests()
          .filter((request) => request.params?.marker !== undefined)
          .map((request) => request.table),
      ).toEqual(["experiment_runs_id_index", "experiment_runs_by_experiment_id_index"]);
    });

    it("resumes at the second index's cursor without refilling the first", async () => {
      const server = serverWith({ failFirstBatches: 0 });
      const resumeFrom = {
        targetsDone: [],
        targetsCounted: ["shared"],
        targetsFailed: [],
        cursor: {
          target: "shared",
          table: "experiment_runs_by_experiment_id_index",
          partition: "202641",
          afterTenantId: "",
          throughTenantId: null,
          slice: 0,
          slices: 1,
        },
        done: 3,
        total: 4,
        batches: 3,
        retries: 0,
      };

      await fillIdIndexes({
        statements: server.client,
        targets: idIndexFillTargets({ privateRoutes: new Map() }),
        indexes: [RUNS, RUNS_BY_EXPERIMENT],
        batchRows: 20,
        checkpoint: checkpointFrom(resumeFrom).checkpoint,
        signal: new AbortController().signal,
        beforeMarker: async () => {},
      });

      const inserts = server
        .requests()
        .filter((request) => request.params?.marker === undefined)
        .map((request) => `${request.table} ${String(request.params?.partition)}`);
      expect(inserts).toEqual([
        "experiment_runs_by_experiment_id_index 202640",
        "experiment_runs_by_experiment_id_index 202640",
      ]);
    });
  });

  describe("given a tenant bigger than one batch on a table sorted by its key", () => {
    /** @scenario "a tenant bigger than a batch is split by key range and read once" */
    it("splits it by key range, so the inserts read each source row once", async () => {
      const server = sortedServer();
      const run = checkpointFrom(null);

      await fillIdIndexes({
        statements: server.client,
        targets: idIndexFillTargets({ privateRoutes: new Map() }),
        indexes: [SPANS],
        checkpoint: run.checkpoint,
        signal: new AbortController().signal,
        batchRows: 10,
        beforeMarker: async () => {},
      });

      expect(server.rowsRead()).toBe(rows.length);
      expect([...server.indexed].toSorted()).toEqual(traces);
      expect(run.saved.map((report) => report.cursor?.throughKey)).toEqual([
        ["t4"],
        ["t8"],
        undefined,
        undefined,
      ]);
    });

    it("resumes a stopped tenant after the last key it committed", async () => {
      const server = sortedServer();
      const run = checkpointFrom({
        targetsDone: [],
        targetsFailed: [],
        cursor: {
          target: "shared",
          table: "stored_spans_id_index",
          partition: "202641",
          afterTenantId: "",
          throughTenantId: "tenant_big",
          slice: 0,
          slices: 1,
          throughKey: ["t4"],
        },
        done: 0,
        total: 1,
        batches: 1,
        retries: 0,
      });

      await fillIdIndexes({
        statements: server.client,
        targets: idIndexFillTargets({ privateRoutes: new Map() }),
        indexes: [SPANS],
        checkpoint: run.checkpoint,
        signal: new AbortController().signal,
        batchRows: 10,
        beforeMarker: async () => {},
      });

      expect([...server.indexed].toSorted()).toEqual(["t5", "t6", "t7", "t8", "t9"]);
      expect(server.rowsRead()).toBe(rows.filter((traceId) => traceId > "t4").length);
    });
  });

  describe("when batches are planned", () => {
    it("gives a tenant larger than a batch one key-split batch where the key is sorted", () => {
      expect(
        planBatches({
          partition: { partition: "p", rows: 50 },
          tenants: [
            { tenantId: "a", rows: 5 },
            { tenantId: "b", rows: 45 },
            { tenantId: "c", rows: 5 },
          ],
          batchRows: 20,
          split: "key",
        }),
      ).toEqual([
        { afterTenantId: "", throughTenantId: "a", slice: 0, slices: 1 },
        { afterTenantId: "a", throughTenantId: "b", slice: 0, slices: 1, byKey: true },
        { afterTenantId: "b", throughTenantId: "c", slice: 0, slices: 1 },
      ]);
    });

    it("bounds a key-split batch by its tenant and a lexicographic key range", () => {
      const { sql, params } = fillStatement({
        index: { ...SPANS, key: ["AggregateType", "AggregateId"] },
        batch: { afterTenantId: "a", throughTenantId: "b", slice: 0, slices: 1, byKey: true },
        keyRange: { after: ["trace", "x1"], through: ["trace", "x9"] },
      });
      expect(sql).toContain(
        "WHERE _partition_id = {partition:String} AND TenantId = {throughTenantId:String} " +
          "AND ((AggregateType > {afterKey0:String}) OR " +
          "(AggregateType = {afterKey0:String} AND AggregateId > {afterKey1:String})) " +
          "AND ((AggregateType < {throughKey0:String}) OR " +
          "(AggregateType = {throughKey0:String} AND AggregateId <= {throughKey1:String}))",
      );
      expect(params).toEqual({
        throughTenantId: "b",
        afterKey0: "trace",
        afterKey1: "x1",
        throughKey0: "trace",
        throughKey1: "x9",
      });
    });

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
