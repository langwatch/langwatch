/**
 * The id index's point read, for one tenant or a fenced tenant set, and the target keying it.
 * Plan: dev/docs/plans/id-index-2026-10-10.md §2 and §6 question 2.
 */
import { describe, expect, it, vi } from "vitest";

import { ClickHouseQueryClient } from "../client.ts";
import type { QueryDriver, QueryRequest } from "../query.ts";
import { TenantGuard } from "../tenantGuard.ts";

function clientWith({
  privateRoutes,
  organizationOf,
}: {
  privateRoutes?: ReadonlyMap<string, string>;
  organizationOf?: (tenantId: string) => Promise<string>;
} = {}) {
  const execute = vi
    .fn<QueryDriver["execute"]>()
    .mockResolvedValue({ rows: [{ n: "3", fromMs: "1000", toMs: "5000" }] });
  const client = new ClickHouseQueryClient({
    driver: { execute, insert: async () => {}, command: async () => {} },
    tenantGuard: new TenantGuard(),
    privateRoutes,
    organizationOf,
  });
  const sent = (): QueryRequest => {
    const request = execute.mock.calls[0]?.[0];
    if (request === undefined) throw new Error("no statement was sent");
    return request;
  };
  return { client, execute, sent };
}

describe("the id index's point read", () => {
  describe("when a fenced read asks the index for its tenant set", () => {
    it("binds the tenant set itself and answers only n, fromMs and toMs", async () => {
      const { client, sent } = clientWith();

      const bounds = await client.indexBounds({
        tenantId: "proj_own",
        tenantIds: ["proj_own", "proj_shared"],
        index: "trace_summaries_id_index",
        key: { TraceId: ["t1"] },
      });

      expect(bounds).toEqual({ n: 3, fromMs: 1000, toMs: 5000 });
      expect(sent().sql).toBe(
        "SELECT count() AS n, toUnixTimestamp64Milli(min(FromAt)) AS fromMs, " +
          "toUnixTimestamp64Milli(max(ToAt)) AS toMs FROM trace_summaries_id_index " +
          "WHERE TenantId IN ({idBound_tenants:Array(String)}) AND TraceId IN ({idIndexKey0:Array(String)})",
      );
      expect(sent().tenantIds).toEqual(["proj_own", "proj_shared"]);
      expect(sent().params).toEqual({
        idIndexKey0: ["t1"],
        idBound_tenants: ["proj_own", "proj_shared"],
      });
    });

    it("refuses a name that is not a plain identifier", async () => {
      const { client, execute } = clientWith();

      await expect(
        client.indexBounds({
          tenantId: "proj_own",
          index: "x; DROP TABLE y",
          key: { TraceId: "t1" },
        }),
      ).rejects.toThrow(/plain ClickHouse identifier/);
      expect(execute).not.toHaveBeenCalled();
    });
  });

  describe("when the client reads an index stored in epoch milliseconds", () => {
    it("binds its own tenant and reads the times as they are", async () => {
      const { client, sent } = clientWith();

      await client.indexBounds({
        tenantId: "proj_own",
        index: "event_log_id_index",
        key: { AggregateType: "trace", AggregateId: "agg_1" },
        timeFormat: "epoch_ms",
      });

      expect(sent().sql).toContain("toInt64(min(FromAt)) AS fromMs");
      expect(sent().sql).toContain(
        "WHERE TenantId = {tenantId:String} AND AggregateType = {idIndexKey0:String} AND AggregateId = {idIndexKey1:String}",
      );
    });
  });

  describe("when the client names the target a tenant's flag is keyed on", () => {
    it("is shared, with no lookup, while no private route exists", async () => {
      const organizationOf = vi.fn<(tenantId: string) => Promise<string>>();
      const { client } = clientWith({ organizationOf });

      await expect(client.targetOf({ tenantId: "proj_own" })).resolves.toBe("shared");
      expect(organizationOf).not.toHaveBeenCalled();
    });

    it("is the organisation when it has a private route, else shared", async () => {
      const { client } = clientWith({
        privateRoutes: new Map([["org_private", "http://private:8123"]]),
        organizationOf: async (tenantId) =>
          tenantId === "proj_private" ? "org_private" : "org_other",
      });

      await expect(client.targetOf({ tenantId: "proj_private" })).resolves.toBe("org_private");
      await expect(client.targetOf({ tenantId: "proj_own" })).resolves.toBe("shared");
    });
  });
});
