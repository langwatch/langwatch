/**
 * The id-index fill's batch walk, cursor and back-off, over the real client and a driver spy.
 * Spec: specs/clickhouse/id-index-reads.feature
 */
import { describe, expect, it, vi } from "vitest";

import { ClickHouseQueryClient } from "../client.ts";
import {
  fillIdIndexes,
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
  const batches = (): Record<string, unknown>[] =>
    command.mock.calls.map(([request]: [QueryRequest]) => ({
      partition: request.params?.partition,
      afterTenantId: request.params?.afterTenantId,
      throughTenantId: request.params?.throughTenantId,
    }));
  return { client, batches };
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
      const flagged: string[] = [];
      const options = {
        targets: idIndexFillTargets({ privateRoutes: new Map() }),
        indexes: [SPANS],
        batchRows: 20,
        beforeFlag: async () => {},
        setFlag: async ({ target }: { target: string }) => {
          flagged.push(target);
        },
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
      expect(flagged).toEqual([]);

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
      expect(flagged).toEqual(["shared"]);
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
          beforeFlag: async () => {},
          setFlag: async () => {},
          sleep: async () => {},
        }),
      ).rejects.toMatchObject({ name: "IdIndexFillIncompleteError" });
      expect(saved.at(-1)?.targetsFailed.map((each) => each.target)).toEqual(["shared"]);
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

    it("visits each private URL once, flagging every organisation on it", () => {
      expect(
        idIndexFillTargets({
          privateRoutes: new Map([
            ["org_b", "http://one"],
            ["org_a", "http://one"],
            ["org_c", "http://two"],
          ]),
        }),
      ).toEqual([
        { key: "shared", flagTargets: ["shared"] },
        { key: "org_a", organizationId: "org_a", flagTargets: ["org_a", "org_b"] },
        { key: "org_c", organizationId: "org_c", flagTargets: ["org_c"] },
      ]);
    });
  });
});
