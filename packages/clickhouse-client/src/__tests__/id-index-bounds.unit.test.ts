/**
 * The id index's point read, on the client and in the fence, and the target that keys its flag.
 * Plan: dev/docs/plans/id-index-2026-10-10.md §2 and §6 question 2.
 */
import { sealAuthorization } from "@langwatch/authorization";
import { describe, expect, it, vi } from "vitest";

import { AuthorizedClickHouse } from "../authorized-reads.ts";
import { ClickHouseQueryClient } from "../client.ts";
import type { QueryDriver, QueryRequest } from "../query.ts";
import { TenantGuard } from "../tenantGuard.ts";

const NOW = 1_800_000_000_000;

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

const proof = sealAuthorization({
  actor: { type: "user", id: "ana" },
  principal: { type: "user", id: "ana" },
  scope: { organizationId: "org_acme" },
  grants: [
    { projectId: "proj_own", permissions: ["traces:view"], via: [], kind: "own" },
    {
      projectId: "proj_shared",
      permissions: ["traces:view"],
      via: ["grant_a"],
      kind: "shared",
      condition: { type: "trace", from: NOW - 1000, until: null },
    },
  ],
  expiresAt: NOW + 60_000,
  purpose: { kind: "route", route: "tracesV2.list" },
});

describe("the id index's point read", () => {
  describe("when the fence reads an index", () => {
    it("binds the proof's tenant set itself and answers only n, fromMs and toMs", async () => {
      const { client, sent } = clientWith();
      const reader = new AuthorizedClickHouse({
        resolveClient: async () => client,
        now: () => NOW,
      }).as(proof, { reads: "traces" });

      const bounds = await reader.indexBounds({
        index: "trace_summaries_id_index",
        key: { TraceId: ["t1"] },
      });

      expect(bounds).toEqual({ n: 3, fromMs: 1000, toMs: 5000 });
      expect(sent().sql).toBe(
        "SELECT count() AS n, toUnixTimestamp64Milli(min(FromAt)) AS fromMs, " +
          "toUnixTimestamp64Milli(max(ToAt)) AS toMs FROM trace_summaries_id_index " +
          "WHERE (TenantId IN ({tenantScope_all:Array(String)})) AND TraceId IN ({idIndexKey0:Array(String)})",
      );
      expect(sent().tenantIds).toEqual(["proj_own", "proj_shared"]);
      expect(sent().params).toEqual({
        idIndexKey0: ["t1"],
        tenantScope_all: ["proj_own", "proj_shared"],
      });
    });

    it("refuses a name that is not a plain identifier", async () => {
      const { client, execute } = clientWith();
      const reader = new AuthorizedClickHouse({
        resolveClient: async () => client,
        now: () => NOW,
      }).as(proof, { reads: "traces" });

      await expect(
        reader.indexBounds({ index: "x; DROP TABLE y", key: { TraceId: "t1" } }),
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
