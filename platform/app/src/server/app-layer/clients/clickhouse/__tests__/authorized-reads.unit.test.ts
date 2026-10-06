/**
 * ADR-144 block C: the store client applies the proof.
 * Spec: specs/governance/aggregate-project.feature
 */
import type { ClickHouseClient } from "@clickhouse/client";
import {
  AccessNotGrantedError,
  type Authorization,
  AuthorizationExpiredError,
  ForgedAuthorizationError,
  sealAuthorization,
} from "@langwatch/actor";
import { describe, expect, it, vi } from "vitest";
import {
  AuthorizedClickHouse,
  expandFragment,
  expandStatement,
  fenceExpression,
  fenceFor,
  StatementScopeError,
  tenantScope,
  tenantScopeKey,
  tenantSet,
} from "../authorized-reads";

const NOW = 1_800_000_000_000;
const AGG = "proj_aggregate";
const A = "proj_member_a";
const B = "proj_member_b";

function proof(
  overrides: Partial<Parameters<typeof sealAuthorization>[0]> = {},
): Authorization {
  return sealAuthorization({
    actor: { type: "user", id: "ana" },
    principal: { type: "user", id: "ana" },
    scope: { organizationId: "org_acme" },
    grants: [
      {
        projectId: AGG,
        permissions: ["traces:view", "analytics:view"],
        via: [],
        kind: "own",
      },
      {
        projectId: A,
        permissions: ["traces:view"],
        via: ["grant_a"],
        kind: "shared",
        condition: { type: "trace", from: NOW - 1000, until: null },
      },
      {
        projectId: B,
        permissions: ["traces:view"],
        via: ["grant_b"],
        kind: "shared",
        condition: { type: "trace", from: 0, until: NOW + 5000 },
      },
    ],
    expiresAt: NOW + 60_000,
    purpose: { kind: "route", route: "tracesV2.list" },
    ...overrides,
  });
}

function clientWith(
  query = vi.fn().mockResolvedValue({ json: async () => [] }),
) {
  const client = { query } as unknown as ClickHouseClient;
  const resolveClient = vi.fn().mockResolvedValue(client);
  return {
    query,
    resolveClient,
    clickhouse: new AuthorizedClickHouse({ resolveClient, now: () => NOW }),
  };
}

describe("AuthorizedClickHouse", () => {
  describe("given a proof with own grant on the aggregate and shared grants on members A and B", () => {
    describe("when a repository queries through the client with that proof", () => {
      // @scenario "The client adds the tenant set from the proof"
      it("restricts the query to tenants aggregate, A and B, and A and B to their windows", async () => {
        const { query, resolveClient, clickhouse } = clientWith();
        const reader = clickhouse.as(proof(), { reads: "traces" });

        await reader.query({
          query: `SELECT TraceId FROM trace_summaries WHERE ${tenantScope("OccurredAt")} AND TraceId = {traceId:String}`,
          query_params: { traceId: "tr-1" },
          format: "JSONEachRow",
        });

        expect(resolveClient).toHaveBeenCalledWith(AGG);
        const sent = query.mock.calls[0]?.[0];
        expect(sent.query).toBe(
          "SELECT TraceId FROM trace_summaries WHERE (TenantId IN ({tenantScope_own:Array(String)}) OR " +
            "(TenantId = {tenantScope_s0:String} AND OccurredAt >= fromUnixTimestamp64Milli({tenantScope_s0_from:Int64})) OR " +
            "(TenantId = {tenantScope_s1:String} AND OccurredAt >= fromUnixTimestamp64Milli({tenantScope_s1_from:Int64}) AND OccurredAt < fromUnixTimestamp64Milli({tenantScope_s1_until:Int64}))) " +
            "AND TraceId = {traceId:String}",
        );
        expect(sent.query_params).toEqual({
          traceId: "tr-1",
          tenantScope_own: [AGG],
          tenantScope_s0: A,
          tenantScope_s0_from: NOW - 1000,
          tenantScope_s1: B,
          tenantScope_s1_from: 0,
          tenantScope_s1_until: NOW + 5000,
        });
        expect(sent.format).toBe("JSONEachRow");
      });

      it("applies the set without a window where a subquery asks for the set alone", () => {
        const fence = fenceFor({ authorization: proof(), reads: "traces" });
        const { query, queryParams } = expandStatement({
          query: `SELECT 1 FROM t WHERE ${tenantScope("OccurredAt")} AND x IN (SELECT x FROM evals WHERE ${tenantSet()})`,
          queryParams: {},
          fence,
        });
        expect(query).toContain(
          "(SELECT x FROM evals WHERE (TenantId IN ({tenantScope_all:Array(String)})))",
        );
        expect(queryParams.tenantScope_all).toEqual([AGG, A, B]);
      });

      it("refuses a statement whose only marker is the set, since the window would never apply", () => {
        const fence = fenceFor({ authorization: proof(), reads: "traces" });
        expect(() =>
          expandStatement({
            query: `SELECT 1 FROM t WHERE ${tenantSet()}`,
            queryParams: {},
            fence,
          }),
        ).toThrow(
          expect.objectContaining({ violation: { kind: "missing-marker" } }),
        );
      });

      it("keys a cache on who is in scope and under which window", () => {
        expect(
          tenantScopeKey({ authorization: proof(), reads: "traces" }),
        ).toBe(`${AGG}|${A}@${NOW - 1000}-|${B}@0-${NOW + 5000}`);
        expect(
          tenantScopeKey({ authorization: proof(), reads: "analytics" }),
        ).toBe(AGG);
      });

      it("applies the same fence at every marker, inside subqueries too", () => {
        const fence = fenceFor({ authorization: proof(), reads: "traces" });
        const { query } = expandStatement({
          query: `SELECT 1 WHERE ${tenantScope("OccurredAt")} AND x IN (SELECT x FROM t WHERE ${tenantScope("StartTime")})`,
          queryParams: {},
          fence,
        });
        expect(query.match(/TenantId IN/g)).toHaveLength(2);
        expect(query).toContain("StartTime >= fromUnixTimestamp64Milli");
        expect(query).toContain("OccurredAt >= fromUnixTimestamp64Milli");
      });
    });
  });

  describe("given a proof minted for traces view", () => {
    describe("when the client is asked to read a resource the proof does not cover", () => {
      // @scenario "A proof declared for one resource is refused for another"
      it("refuses it as not granted", () => {
        const { clickhouse } = clientWith();
        const tracesOnly = proof({
          grants: [
            {
              projectId: AGG,
              permissions: ["traces:view"],
              via: [],
              kind: "own",
            },
          ],
        });
        expect(() => clickhouse.as(tracesOnly, { reads: "analytics" })).toThrow(
          AccessNotGrantedError,
        );
      });

      it("leaves out a shared grant minted for another resource instead of widening it", () => {
        const fence = fenceFor({ authorization: proof(), reads: "analytics" });
        expect(fence).toEqual({ own: [AGG], shared: [] });
      });
    });
  });

  describe("given a proof built outside the authorizer or past its expiry", () => {
    describe("when a reader is requested", () => {
      // @scenario "A proof built outside the authorizer is refused"
      it("refuses a hand-built proof as forged", () => {
        const { clickhouse } = clientWith();
        const forged = { ...proof() };
        expect(() => clickhouse.as(forged, { reads: "traces" })).toThrow(
          ForgedAuthorizationError,
        );
      });

      // @scenario "An expired proof is refused"
      it("refuses an expired proof", () => {
        const { clickhouse } = clientWith();
        const expired = proof({ expiresAt: NOW });
        expect(() => clickhouse.as(expired, { reads: "traces" })).toThrow(
          AuthorizationExpiredError,
        );
      });
    });
  });

  describe("given a statement that does not leave the tenant to the fence", () => {
    const fence = fenceFor({ authorization: proof(), reads: "traces" });
    const expand = (query: string, queryParams: Record<string, unknown> = {}) =>
      expandStatement({ query, queryParams, fence });

    describe("when it carries no marker", () => {
      it("refuses it", () => {
        expect(() =>
          expand("SELECT 1 FROM t WHERE TraceId = {id:String}"),
        ).toThrow(
          expect.objectContaining({ violation: { kind: "missing-marker" } }),
        );
      });
    });

    describe("when it names the tenant column in a predicate of its own", () => {
      it("refuses each comparison form", () => {
        for (const predicate of [
          "TenantId = {t:String}",
          "TenantId IN ('a')",
          "TenantId NOT IN ('a')",
          "TenantId != 'a'",
          "tenantid='a'",
        ]) {
          expect(() =>
            expand(
              `SELECT 1 FROM t WHERE ${tenantScope("OccurredAt")} AND ${predicate}`,
            ),
          ).toThrow(
            expect.objectContaining({
              violation: { kind: "hand-written-tenant-predicate" },
            }),
          );
        }
      });

      it("still allows the column as a projection or a dedup tuple member", () => {
        const { query } = expand(
          `SELECT TenantId, TraceId FROM t WHERE ${tenantScope("OccurredAt")} AND (TenantId, TraceId, UpdatedAt) IN (SELECT TenantId, TraceId, max(UpdatedAt) FROM t WHERE ${tenantScope("OccurredAt")} GROUP BY TenantId, TraceId)`,
        );
        expect(query).toContain(
          "SELECT TenantId, TraceId FROM t WHERE (TenantId IN",
        );
      });
    });

    describe("when the marker names the evaluation table's own occurrence time", () => {
      it("applies the window to ScheduledAt", () => {
        const { query } = expand(
          `SELECT 1 FROM evaluation_runs WHERE ${tenantScope("ScheduledAt")}`,
        );
        expect(query).toContain(
          "ScheduledAt >= fromUnixTimestamp64Milli({tenantScope_s0_from:Int64})",
        );
      });
    });

    describe("when the marker names a column the window cannot be applied to", () => {
      it("refuses it", () => {
        expect(() =>
          expand("SELECT 1 FROM t WHERE {{tenantScope:TraceId}}"),
        ).toThrow(
          expect.objectContaining({
            violation: { kind: "unknown-time-column", column: "TraceId" },
          }),
        );
      });
    });

    describe("when a parameter uses the reserved prefix", () => {
      it("refuses it before anything is sent", () => {
        expect(() =>
          expand(`SELECT 1 FROM t WHERE ${tenantScope("OccurredAt")}`, {
            tenantScope_own: ["x"],
          }),
        ).toThrow(StatementScopeError);
      });
    });
  });

  describe("given a compiled filter fragment a legacy statement has to embed", () => {
    describe("when the fragment is expanded on its own", () => {
      it("expands each marker into the fence and leaves the statement checks to the caller", () => {
        const fence = fenceFor({ authorization: proof(), reads: "traces" });
        const { sql, params } = expandFragment({
          fragment: `Status = {p0:String} AND TraceId IN (SELECT TraceId FROM stored_spans WHERE ${tenantScope("StartTime")} AND x IN (SELECT x FROM evals WHERE ${tenantSet()}))`,
          queryParams: { p0: "error" },
          fence,
        });
        expect(sql).toContain("StartTime >= fromUnixTimestamp64Milli");
        expect(sql).toContain(
          "(TenantId IN ({tenantScope_all:Array(String)}))",
        );
        expect(sql).not.toContain("{{tenantScope");
        expect(params).toMatchObject({
          p0: "error",
          tenantScope_own: [AGG],
          tenantScope_all: [AGG, A, B],
        });
      });

      it("refuses a fragment that names the tenant in a predicate of its own", () => {
        const fence = fenceFor({ authorization: proof(), reads: "traces" });
        expect(() =>
          expandFragment({
            fragment: "Status = {p0:String} AND TenantId = {t:String}",
            queryParams: { p0: "error", t: A },
            fence,
          }),
        ).toThrow(
          expect.objectContaining({
            violation: { kind: "hand-written-tenant-predicate" },
          }),
        );
      });

      it("refuses a fragment whose parameters use the reserved prefix", () => {
        const fence = fenceFor({ authorization: proof(), reads: "traces" });
        expect(() =>
          expandFragment({
            fragment: "Status = {p0:String}",
            queryParams: { p0: "error", tenantScope_own: ["x"] },
            fence,
          }),
        ).toThrow(
          expect.objectContaining({
            violation: { kind: "reserved-param", param: "tenantScope_own" },
          }),
        );
      });

      it("passes a fragment with no marker through unchanged", () => {
        const fence = fenceFor({ authorization: proof(), reads: "traces" });
        const { sql, params } = expandFragment({
          fragment: "Status = {p0:String}",
          queryParams: { p0: "error" },
          fence,
        });
        expect(sql).toBe("Status = {p0:String}");
        expect(params).toEqual({ p0: "error" });
      });
    });
  });

  describe("given a plain project's proof with no shared grants", () => {
    describe("when the fence is built", () => {
      // @scenario "A plain project reads the same rows as before"
      it("fences to the one own project and nothing else", () => {
        const own = proof({
          grants: [
            {
              projectId: AGG,
              permissions: ["traces:view"],
              via: [],
              kind: "own",
            },
          ],
        });
        const { sql, params } = fenceExpression({
          fence: fenceFor({ authorization: own, reads: "traces" }),
          column: "OccurredAt",
        });
        expect(sql).toBe("(TenantId IN ({tenantScope_own:Array(String)}))");
        expect(params).toEqual({ tenantScope_own: [AGG] });
      });
    });
  });
});
