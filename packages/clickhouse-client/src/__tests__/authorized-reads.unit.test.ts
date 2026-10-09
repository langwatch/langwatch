/**
 * ADR-175: the store client applies the proof.
 * Spec: specs/governance/aggregate-project.feature
 */
import {
  type Authorization,
  narrowAuthorization,
  sealAuthorization,
} from "@langwatch/authorization";
import {
  fenceFor,
  ownProjectIdOf,
  singleTenantOf,
  tenantScope,
  tenantScopeKey,
  tenantSet,
} from "@langwatch/authorization/tenant-fence";
import { describe, expect, it } from "vitest";

import {
  AuthorizedClickHouse,
  expandFragment,
  expandStatement,
  fenceExpression,
  type TenantScopedStatementClient,
} from "../authorized-reads.ts";
import type { QueryRequest, QueryResult } from "../query.ts";

const NOW = 1_800_000_000_000;
const AGG = "proj_aggregate";
const A = "proj_member_a";
const B = "proj_member_b";

function proof(overrides: Partial<Parameters<typeof sealAuthorization>[0]> = {}): Authorization {
  return sealAuthorization({
    actor: { type: "user", id: "ana" },
    principal: { type: "user", id: "ana" },
    scope: { organizationId: "org_acme" },
    grants: [
      { projectId: AGG, permissions: ["traces:view", "analytics:view"], via: [], kind: "own" },
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

/** The windowed fence on `column`, as the reader writes it for shared grants. */
function windowedFence(column: string, { own = true } = {}): string {
  const ids = "{tenantScope_ids:Array(String)}";
  const edge = (name: string) =>
    `transform(TenantId, ${ids}, {tenantScope_${name}:Array(Int64)}, toInt64(0))`;
  const windowed =
    `(has(${ids}, TenantId) AND ${column} >= fromUnixTimestamp64Milli(${edge("from")}) ` +
    `AND (${edge("until")} = 0 OR ${column} < fromUnixTimestamp64Milli(${edge("until")})))`;
  const picks = own ? `(has({tenantScope_own:Array(String)}, TenantId) OR ${windowed})` : windowed;
  return `(TenantId IN ({tenantScope_all:Array(String)}) AND ${picks})`;
}

/** A statement client that records what it is sent and answers no rows. */
function recordingClient() {
  const sent: QueryRequest[] = [];
  const client: TenantScopedStatementClient = {
    query: <Row>(request: QueryRequest): Promise<QueryResult<Row>> => {
      sent.push(request);
      return Promise.resolve({ rows: [] });
    },
  };
  return { sent, clickhouse: AuthorizedClickHouse.create({ clickhouse: client, now: () => NOW }) };
}

const codeOf = (run: () => unknown): unknown => {
  try {
    run();
  } catch (error) {
    return (error as { code?: unknown }).code;
  }
  return void 0;
};

const violationOf = (run: () => unknown): unknown => {
  try {
    run();
  } catch (error) {
    return (error as { violation?: unknown }).violation;
  }
  return void 0;
};

describe("AuthorizedClickHouse", () => {
  describe("given a proof with own grant on the aggregate and shared grants on members A and B", () => {
    describe("when a repository queries through the client with that proof", () => {
      /** @scenario "The client adds the tenant set from the proof" */
      it("restricts the query to tenants aggregate, A and B, and A and B to their windows", async () => {
        const { sent, clickhouse } = recordingClient();
        const reader = clickhouse.as(proof(), { reads: "traces" });

        await reader.query({
          sql: `SELECT TraceId FROM trace_summaries WHERE ${tenantScope("OccurredAt")} AND TraceId = {traceId:String}`,
          params: { traceId: "tr-1" },
        });

        const request = sent[0];
        expect(request?.tenantId).toBe(AGG);
        expect(request?.tenantIds).toEqual([AGG, A, B]);
        expect(request?.sql).toBe(
          `SELECT TraceId FROM trace_summaries WHERE ${windowedFence("OccurredAt")} AND TraceId = {traceId:String}`,
        );
        expect(request?.params).toEqual({
          traceId: "tr-1",
          tenantScope_all: [AGG, A, B],
          tenantScope_own: [AGG],
          tenantScope_ids: [A, B],
          tenantScope_from: [NOW - 1000, 0],
          tenantScope_until: [0, NOW + 5000],
        });
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
        expect(
          violationOf(() =>
            expandStatement({
              query: `SELECT 1 FROM t WHERE ${tenantSet()}`,
              queryParams: {},
              fence,
            }),
          ),
        ).toEqual({ kind: "missing-marker" });
      });

      it("keys a cache on who is in scope and under which window", () => {
        const key = tenantScopeKey({ authorization: proof(), reads: "traces" });
        expect(key).toMatch(new RegExp(`^${AGG}\\+2:[0-9a-f]{64}$`));
        expect(tenantScopeKey({ authorization: proof(), reads: "analytics" })).toBe(AGG);
      });

      it("keys the same windows the same way whatever order the grants come in", () => {
        const [own, a, b] = proof().grants;
        const reordered = proof({ grants: [own!, b!, a!] });
        expect(tenantScopeKey({ authorization: reordered, reads: "traces" })).toBe(
          tenantScopeKey({ authorization: proof(), reads: "traces" }),
        );
      });

      it("keys a different window differently", () => {
        const [own, a, b] = proof().grants;
        const widened = proof({
          grants: [own!, { ...a!, condition: { type: "trace", from: 0, until: null } }, b!],
        });
        expect(tenantScopeKey({ authorization: widened, reads: "traces" })).not.toBe(
          tenantScopeKey({ authorization: proof(), reads: "traces" }),
        );
      });

      it("applies the same fence at every marker, inside subqueries too", () => {
        const fence = fenceFor({ authorization: proof(), reads: "traces" });
        const { query } = expandStatement({
          query: `SELECT 1 WHERE ${tenantScope("OccurredAt")} AND x IN (SELECT x FROM t WHERE ${tenantScope("StartTime")})`,
          queryParams: {},
          fence,
        });
        expect(query).toContain(windowedFence("OccurredAt"));
        expect(query).toContain(windowedFence("StartTime"));
      });
    });
  });

  describe("given a proof minted for traces view", () => {
    describe("when the client is asked to read a resource the proof does not cover", () => {
      /** @scenario "A proof declared for one resource is refused for another" */
      it("refuses it as not granted", () => {
        const { clickhouse } = recordingClient();
        const tracesOnly = proof({
          grants: [{ projectId: AGG, permissions: ["traces:view"], via: [], kind: "own" }],
        });
        expect(codeOf(() => clickhouse.as(tracesOnly, { reads: "analytics" }))).toBe(
          "access_not_granted",
        );
      });

      it("leaves out a shared grant minted for another resource instead of widening it", () => {
        const fence = fenceFor({ authorization: proof(), reads: "analytics" });
        expect(fence).toEqual({ own: [AGG], shared: [] });
      });
    });
  });

  describe("given a shared grant whose window applies to spans, not traces", () => {
    describe("when the fence for a traces read is built", () => {
      it("leaves that grant out, so its window never opens trace rows", () => {
        const authorization = proof({
          grants: [
            { projectId: AGG, permissions: ["traces:view"], via: [], kind: "own" },
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
              condition: { type: "span", from: 0, until: null },
            },
          ],
        });

        expect(fenceFor({ authorization, reads: "traces" })).toEqual({
          own: [AGG],
          shared: [{ projectId: A, from: NOW - 1000, until: null }],
        });
      });
    });
  });

  describe("given a proof built outside the authorizer or past its expiry", () => {
    describe("when a reader is requested", () => {
      /** @scenario "A proof built outside the authorizer is refused" */
      it("refuses a hand-built proof as forged", () => {
        const { clickhouse } = recordingClient();
        const forged = { ...proof() };
        expect(codeOf(() => clickhouse.as(forged, { reads: "traces" }))).toBe(
          "authorization_forged",
        );
      });

      /** @scenario "An expired proof is refused" */
      it("refuses an expired proof", () => {
        const { clickhouse } = recordingClient();
        const expired = proof({ expiresAt: NOW });
        expect(codeOf(() => clickhouse.as(expired, { reads: "traces" }))).toBe(
          "authorization_expired",
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
        expect(violationOf(() => expand("SELECT 1 FROM t WHERE TraceId = {id:String}"))).toEqual({
          kind: "missing-marker",
        });
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
          expect(
            violationOf(() =>
              expand(`SELECT 1 FROM t WHERE ${tenantScope("OccurredAt")} AND ${predicate}`),
            ),
          ).toEqual({ kind: "hand-written-tenant-predicate" });
        }
      });

      it("still allows the column as a projection or a dedup tuple member", () => {
        const { query } = expand(
          `SELECT TenantId, TraceId FROM t WHERE ${tenantScope("OccurredAt")} AND (TenantId, TraceId, UpdatedAt) IN (SELECT TenantId, TraceId, max(UpdatedAt) FROM t WHERE ${tenantScope("OccurredAt")} GROUP BY TenantId, TraceId)`,
        );
        expect(query).toContain("SELECT TenantId, TraceId FROM t WHERE (TenantId IN");
      });
    });

    describe("when the marker names the evaluation table's own occurrence time", () => {
      it("applies the window to ScheduledAt", () => {
        const { query } = expand(
          `SELECT 1 FROM evaluation_runs WHERE ${tenantScope("ScheduledAt")}`,
        );
        expect(query).toContain(windowedFence("ScheduledAt"));
      });
    });

    describe("when the marker names a column the window cannot be applied to", () => {
      it("refuses it", () => {
        expect(violationOf(() => expand("SELECT 1 FROM t WHERE {{tenantScope:TraceId}}"))).toEqual({
          kind: "unknown-time-column",
          column: "TraceId",
        });
      });
    });

    describe("when a parameter uses the reserved prefix", () => {
      it("refuses it before anything is sent", () => {
        expect(
          violationOf(() =>
            expand(`SELECT 1 FROM t WHERE ${tenantScope("OccurredAt")}`, {
              tenantScope_own: ["x"],
            }),
          ),
        ).toEqual({ kind: "reserved-param", param: "tenantScope_own" });
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
        expect(sql).toContain("(TenantId IN ({tenantScope_all:Array(String)}))");
        expect(sql).not.toContain("{{tenantScope");
        expect(params).toMatchObject({
          p0: "error",
          tenantScope_own: [AGG],
          tenantScope_all: [AGG, A, B],
        });
      });

      it("refuses a fragment that names the tenant in a predicate of its own", () => {
        const fence = fenceFor({ authorization: proof(), reads: "traces" });
        expect(
          violationOf(() =>
            expandFragment({
              fragment: "Status = {p0:String} AND TenantId = {t:String}",
              queryParams: { p0: "error", t: A },
              fence,
            }),
          ),
        ).toEqual({ kind: "hand-written-tenant-predicate" });
      });

      it("refuses a fragment whose parameters use the reserved prefix", () => {
        const fence = fenceFor({ authorization: proof(), reads: "traces" });
        expect(
          violationOf(() =>
            expandFragment({
              fragment: "Status = {p0:String}",
              queryParams: { p0: "error", tenantScope_own: ["x"] },
              fence,
            }),
          ),
        ).toEqual({ kind: "reserved-param", param: "tenantScope_own" });
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
      /** @scenario "A plain project reads the same rows as before" */
      it("fences to the one own project and nothing else", async () => {
        const own = proof({
          grants: [{ projectId: AGG, permissions: ["traces:view"], via: [], kind: "own" }],
        });
        const { sql, params } = fenceExpression({
          fence: fenceFor({ authorization: own, reads: "traces" }),
          column: "OccurredAt",
        });
        expect(sql).toBe("(TenantId IN ({tenantScope_all:Array(String)}))");
        expect(params).toEqual({ tenantScope_all: [AGG] });

        const { sent, clickhouse } = recordingClient();
        await clickhouse
          .as(own, { reads: "traces" })
          .query({ sql: `SELECT 1 FROM t WHERE ${tenantScope("OccurredAt")}` });
        expect(sent[0]?.tenantId).toBe(AGG);
        expect(sent[0]?.tenantIds).toBeUndefined();
      });
    });
  });

  describe("given an aggregate's proof with thousands of members", () => {
    const withMembers = (count: number): Authorization =>
      proof({
        grants: [
          proof().grants[0]!,
          ...Array.from({ length: count }, (_, index) => ({
            projectId: `proj_member_${index}`,
            permissions: ["traces:view"],
            via: [`grant_${index}`],
            kind: "shared" as const,
            condition: { type: "trace" as const, from: index, until: null },
          })),
        ],
      });

    describe("when the fence is built", () => {
      it("writes the same statement text for 2,000 members as for two", () => {
        const sqlFor = (count: number) =>
          fenceExpression({
            fence: fenceFor({ authorization: withMembers(count), reads: "traces" }),
            column: "OccurredAt",
          }).sql;
        expect(sqlFor(2_000)).toBe(sqlFor(2));
      });

      it("keeps the cache key short at 2,000 members", () => {
        const key = tenantScopeKey({ authorization: withMembers(2_000), reads: "traces" });
        expect(key).toBe(`${AGG}+2000:${key.slice(-64)}`);
      });
    });
  });

  describe("given a shared grant whose window closes at the epoch", () => {
    describe("when the fence binds its until", () => {
      it("never binds it as the open-window value", () => {
        const closed = proof({
          grants: [
            proof().grants[0]!,
            {
              projectId: A,
              permissions: ["traces:view"],
              via: ["grant_a"],
              kind: "shared",
              condition: { type: "trace", from: 0, until: 0 },
            },
          ],
        });
        const { params } = fenceExpression({
          fence: fenceFor({ authorization: closed, reads: "traces" }),
          column: "OccurredAt",
        });
        expect(params.tenantScope_until).toEqual([1]);
      });
    });
  });

  describe("given an aggregate's proof narrowed to one member", () => {
    const narrowedTo = (projectId: string): Authorization => {
      const narrowed = narrowAuthorization({ authorization: proof(), projectId });
      if (!narrowed) throw new Error(`expected ${projectId} in the proof`);
      return narrowed;
    };

    describe("when the fence is built", () => {
      it("fences that member alone, inside its grant's window", () => {
        const { sql, params } = fenceExpression({
          fence: fenceFor({ authorization: narrowedTo(A), reads: "traces" }),
          column: "OccurredAt",
        });
        expect(sql).toBe(windowedFence("OccurredAt", { own: false }));
        expect(params).toEqual({
          tenantScope_all: [A],
          tenantScope_ids: [A],
          tenantScope_from: [NOW - 1000],
          tenantScope_until: [0],
        });
      });

      it("fences the own project alone when narrowed to it", () => {
        expect(fenceFor({ authorization: narrowedTo(AGG), reads: "traces" })).toEqual({
          own: [AGG],
          shared: [],
        });
      });

      it("refuses a resource the member's grant does not carry", () => {
        expect(codeOf(() => fenceFor({ authorization: narrowedTo(A), reads: "analytics" }))).toBe(
          "access_not_granted",
        );
      });
    });

    describe("when the reader sends the statement", () => {
      it("names the member it reads as the statement's tenant", async () => {
        const { clickhouse, sent } = recordingClient();
        await clickhouse
          .as(narrowedTo(A), { reads: "traces" })
          .query({ sql: `SELECT 1 FROM t WHERE ${tenantScope("OccurredAt")}` });

        expect(sent[0]?.tenantId).toBe(A);
        expect(sent[0]?.params).toEqual({
          tenantScope_all: [A],
          tenantScope_ids: [A],
          tenantScope_from: [NOW - 1000],
          tenantScope_until: [0],
        });
      });
    });

    describe("when the one project it reads is asked for", () => {
      it("names the member it was narrowed to, and the own project stays put", () => {
        expect(singleTenantOf({ authorization: narrowedTo(B), reads: "traces" })).toBe(B);
        expect(ownProjectIdOf({ authorization: narrowedTo(B), reads: "traces" })).toBe(AGG);
      });

      it("names none while the proof still spans its members", () => {
        expect(singleTenantOf({ authorization: proof(), reads: "traces" })).toBeUndefined();
      });
    });
  });
});
