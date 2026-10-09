/**
 * ADR-175: the tenant guard accepts the fence the authorized reader writes, by value, and
 * nothing else that binds tenants as an array.
 */
import { sealAuthorization } from "@langwatch/authorization";
import { tenantScope } from "@langwatch/authorization/tenant-fence";
import { describe, expect, it } from "vitest";

import { AuthorizedClickHouse } from "../authorized-reads.ts";
import { ClickHouseQueryClient } from "../client.ts";
import type { QueryRequest } from "../query.ts";
import { checkTenantScope, TenantGuard } from "../tenantGuard.ts";

const NOW = 1_800_000_000_000;
const AGG = "proj_aggregate";
const A = "proj_member_a";
const OUTSIDER = "proj_outsider";

const FENCE =
  "(TenantId IN ({tenantScope_all:Array(String)}) AND (has({tenantScope_own:Array(String)}, TenantId) OR has({tenantScope_ids:Array(String)}, TenantId)))";

describe("the tenant guard and the reader's fence", () => {
  describe("given the fence's tenant set bound to exactly the declared tenants", () => {
    describe("when the statement is checked", () => {
      it("accepts it", () => {
        expect(
          checkTenantScope({
            sql: `SELECT 1 FROM trace_summaries WHERE ${FENCE} AND TraceId = {id:String}`,
            params: { tenantScope_all: [AGG, A], id: "tr-1" },
            tenantId: AGG,
            tenantIds: [AGG, A],
          }),
        ).toBeNull();
      });

      it("accepts one tenant's fence with no declared set", () => {
        expect(
          checkTenantScope({
            sql: "SELECT 1 FROM t WHERE (TenantId IN ({tenantScope_all:Array(String)}))",
            params: { tenantScope_all: [AGG] },
            tenantId: AGG,
          }),
        ).toBeNull();
      });
    });
  });

  describe("given the fence's tenant set bound to anything but the declared tenants", () => {
    describe("when the statement is checked", () => {
      it("refuses a tenant outside the declared set", () => {
        expect(
          checkTenantScope({
            sql: `SELECT 1 FROM t WHERE ${FENCE}`,
            params: { tenantScope_all: [AGG, OUTSIDER] },
            tenantId: AGG,
            tenantIds: [AGG, A],
          }),
        ).toMatchObject({ kind: "tenant-set-mismatch" });
      });

      it("refuses a set that leaves the request's own tenant out", () => {
        expect(
          checkTenantScope({
            sql: "SELECT 1 FROM t WHERE (TenantId IN ({tenantScope_all:Array(String)}))",
            params: { tenantScope_all: [A] },
            tenantId: AGG,
          }),
        ).toMatchObject({ kind: "tenant-set-mismatch" });
      });

      it("refuses a set that is not bound at all", () => {
        expect(
          checkTenantScope({
            sql: "SELECT 1 FROM t WHERE (TenantId IN ({tenantScope_all:Array(String)}))",
            params: {},
            tenantId: AGG,
          }),
        ).toEqual({ kind: "missing-param", param: "tenantScope_all" });
      });

      it("refuses an OR that disjoins the fence away", () => {
        expect(
          checkTenantScope({
            sql: "SELECT 1 FROM t WHERE TenantId IN ({tenantScope_all:Array(String)}) OR 1 = 1",
            params: { tenantScope_all: [AGG] },
            tenantId: AGG,
          }),
        ).toEqual({ kind: "weakening-disjunction" });
      });
    });
  });

  describe("given a hand-written tenant array under any other parameter name", () => {
    describe("when the statement is checked against a declared set", () => {
      it("does not accept it as scoping", () => {
        expect(
          checkTenantScope({
            sql: "SELECT 1 FROM t WHERE TenantId IN ({tenants:Array(String)})",
            params: { tenants: [AGG, A] },
            tenantId: AGG,
            tenantIds: [AGG, A],
          }),
        ).toEqual({ kind: "missing-predicate" });
      });
    });
  });

  describe("given the reader in front of a guarded client", () => {
    describe("when an aggregate's proof reads through it", () => {
      it("passes the guard and reaches the driver with the declared set", async () => {
        const executed: QueryRequest[] = [];
        const client = new ClickHouseQueryClient({
          driver: {
            execute: <Row>(request: QueryRequest) => {
              executed.push(request);
              return Promise.resolve({ rows: [] as Row[] });
            },
            insert: () => Promise.resolve(),
            command: () => Promise.resolve(),
          },
          tenantGuard: new TenantGuard(),
        });
        const authorization = sealAuthorization({
          actor: { type: "user", id: "ana" },
          principal: { type: "user", id: "ana" },
          scope: { organizationId: "org_acme" },
          grants: [
            { projectId: AGG, permissions: ["traces:view"], via: [], kind: "own" },
            {
              projectId: A,
              permissions: ["traces:view"],
              via: ["grant_a"],
              kind: "shared",
              condition: { type: "trace", from: NOW - 1000, until: NOW + 1000 },
            },
          ],
          expiresAt: NOW + 60_000,
          purpose: { kind: "route", route: "test" },
        });

        await AuthorizedClickHouse.create({ clickhouse: client, now: () => NOW })
          .as(authorization, { reads: "traces" })
          .query({
            sql: `SELECT TraceId FROM trace_summaries WHERE ${tenantScope("OccurredAt")} AND (TenantId, TraceId, UpdatedAt) IN (SELECT TenantId, TraceId, max(UpdatedAt) FROM trace_summaries WHERE ${tenantScope("OccurredAt")} GROUP BY TenantId, TraceId)`,
          });

        expect(executed).toHaveLength(1);
        expect(executed[0]?.tenantIds).toEqual([AGG, A]);
      });
    });
  });
});
