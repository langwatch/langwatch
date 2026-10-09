/**
 * M8487-GUARD-ARRAY: the tenant guard admits the proof fence's one `Array(String)` tenant set.
 * Spec: specs/governance/aggregate-project.feature
 */
import { type Authorization, sealAuthorization } from "@langwatch/authorization";
import { describe, expect, it, vi } from "vitest";

import { AuthorizedClickHouse, fenceExpression, tenantScope } from "../authorized-reads.ts";
import { ClickHouseQueryClient } from "../client.ts";
import type { QueryDriver } from "../query.ts";
import { checkTenantScope, TenantGuard } from "../tenantGuard.ts";

const NOW = 1_800_000_000_000;
const AGG = "proj_aggregate";
const OUTSIDE = "proj_outside";
const member = (index: number) => `proj_member_${index}`;
const READ = `SELECT TraceId FROM trace_summaries WHERE ${tenantScope("OccurredAt")} AND TraceId = {traceId:String}`;

/** An aggregate's proof: its own grant plus `count` members shared under trace windows. */
function aggregateProof(count: number): Authorization {
  return sealAuthorization({
    actor: { type: "user", id: "ana" },
    principal: { type: "user", id: "ana" },
    scope: { organizationId: "org_acme" },
    grants: [
      { projectId: AGG, permissions: ["traces:view"], via: [], kind: "own" },
      ...Array.from({ length: count }, (_, index) => ({
        projectId: member(index),
        permissions: ["traces:view" as const],
        via: [`grant_${index}`],
        kind: "shared" as const,
        condition: { type: "trace" as const, from: index, until: index % 2 === 0 ? null : NOW },
      })),
    ],
    expiresAt: NOW + 60_000,
    purpose: { kind: "route", route: "tracesV2.list" },
  });
}

/** A reader whose routed client runs `new TenantGuard()`, as the process stores wire it. */
function guardedReader(authorization: Authorization) {
  const execute = vi.fn<QueryDriver["execute"]>().mockResolvedValue({ rows: [] });
  const client = new ClickHouseQueryClient({
    driver: { execute, insert: async () => {}, command: async () => {} },
    tenantGuard: new TenantGuard(),
  });
  const clickhouse = new AuthorizedClickHouse({
    resolveClient: async () => client,
    now: () => NOW,
  });
  return { execute, reader: clickhouse.as(authorization, { reads: "traces" }) };
}

describe("a tenant set bound as one Array(String) parameter", () => {
  describe("given an aggregate's proof with shared members", () => {
    describe("when a repository reads through a guarded client", () => {
      it.each([2, 2_000])("sends the fenced statement for %i members", async (count) => {
        const { execute, reader } = guardedReader(aggregateProof(count));

        await reader.query({ query: READ, query_params: { traceId: "tr-1" } });

        expect(execute).toHaveBeenCalledTimes(1);
        expect(execute.mock.calls[0]?.[0].tenantIds).toHaveLength(count + 1);
      });
    });
  });

  describe("given the fence narrowed to one shared member", () => {
    it("accepts the member's window beneath the set", () => {
      const { sql, params } = fenceExpression({
        fence: { own: [], shared: [{ projectId: member(0), from: 0, until: null }] },
        column: "OccurredAt",
      });
      expect(
        checkTenantScope({
          sql: `SELECT 1 FROM t WHERE ${sql}`,
          params,
          tenantId: member(0),
          tenantIds: [member(0)],
        }),
      ).toBeNull();
    });
  });

  describe("given the aggregate's fenced statement", () => {
    const tenantIds = [AGG, member(0), member(1)];
    const fence = fenceExpression({
      fence: {
        own: [AGG],
        shared: [
          { projectId: member(0), from: 0, until: null },
          { projectId: member(1), from: 5, until: NOW },
        ],
      },
      column: "OccurredAt",
    });
    const read = `SELECT TraceId FROM trace_summaries WHERE ${fence.sql}`;
    const check = ({ sql = read, params = {} }: { sql?: string; params?: object }) =>
      checkTenantScope({ sql, params: { ...fence.params, ...params }, tenantId: AGG, tenantIds });

    it("accepts it, the shared-grant OR included", () => {
      // @scenario "The tenant guard admits the proof's fence and nothing wider"
      expect(check({})).toBeNull();
    });

    it("accepts NOT IN, IS NOT NULL and a NOT that names no tenant beside it", () => {
      const sql = `${read} AND Name NOT IN ('a') AND Model IS NOT NULL AND NOT (Cost = 0)`;
      expect(check({ sql })).toBeNull();
    });

    it.each([
      ["holding a tenant outside tenantIds", { tenantScope_all: [...tenantIds, OUTSIDE] }],
      ["missing a declared tenant", { tenantScope_all: [AGG, member(0)] }],
      ["bound to one string", { tenantScope_all: AGG }],
      ["beneath the set binding a tenant outside tenantIds", { tenantScope_own: [OUTSIDE] }],
    ])("refuses an Array parameter %s", (_label, params) => {
      expect(check({ params })).toMatchObject({ kind: "tenant-set-mismatch" });
    });

    it.each([
      ["at the top level beside the set", `${read} OR 1 = 1`],
      [
        "disjoining the bound set itself in a subquery beneath it",
        `${read} AND TraceId IN (SELECT TraceId FROM spans WHERE TenantId IN ({tenantScope_all:Array(String)}) OR 1 = 1)`,
      ],
      [
        "in a subquery inside the fence's bracket, disjoining a narrower set",
        `SELECT 1 FROM t WHERE (TenantId IN ({tenantScope_all:Array(String)}) AND TraceId IN (SELECT TraceId FROM spans WHERE TenantId IN ({tenantScope_own:Array(String)}) OR 1 = 1))`,
      ],
      [
        "in a subquery inside the fence's bracket naming no tenant",
        `SELECT 1 FROM t WHERE (TenantId IN ({tenantScope_all:Array(String)}) AND TraceId IN (SELECT TraceId FROM spans WHERE Name = 'a' OR 1 = 1))`,
      ],
      [
        "bracketed inside a subquery inside the fence's bracket",
        `SELECT 1 FROM t WHERE (TenantId IN ({tenantScope_all:Array(String)}) AND EXISTS (select 1 FROM spans WHERE (Name = 'a' or 1 = 1)))`,
      ],
    ])("refuses an OR %s", (_label, sql) => {
      expect(check({ sql })).toEqual({ kind: "weakening-disjunction" });
    });

    it.each([
      ["the fence", `SELECT 1 FROM t WHERE NOT ${fence.sql}`],
      ["the bare set", "SELECT 1 FROM t WHERE NOT TenantId IN ({tenantScope_all:Array(String)})"],
      [
        "the set, behind a comment and a newline",
        "SELECT 1 FROM t WHERE not /* x */\n t.TenantId IN ({tenantScope_all:Array(String)})",
      ],
    ])("refuses NOT in front of %s", (_label, sql) => {
      expect(check({ sql })).toEqual({ kind: "negated-predicate" });
    });

    it("refuses a hand-written TenantId IN literal list", () => {
      expect(
        check({
          sql: `SELECT 1 FROM t WHERE TenantId IN ('${AGG}', '${member(0)}', '${member(1)}')`,
        }),
      ).toEqual({ kind: "missing-predicate" });
    });

    it.each([
      ["bare", "NOT TenantId = {t:String}"],
      ["alias-qualified", "NOT s.TenantId = {t:String}"],
      ["bracketed", "NOT (TenantId = {t:String})"],
      ["doubly bracketed, mixed case", "nOt ((TenantId = {t:String}))"],
      ["as the not() function", "not(TenantId = {t:String})"],
      ["after a line comment", "NOT -- x\nTenantId = {t:String}"],
      ["bracketed beside another condition", "NOT (Name = 'a' AND TenantId = {t:String})"],
    ])("refuses a NOT %s in front of a one-tenant predicate", (_label, where) => {
      expect(
        checkTenantScope({
          sql: `SELECT 1 FROM spans s WHERE ${where}`,
          params: { t: AGG },
          tenantId: AGG,
        }),
      ).toEqual({ kind: "negated-predicate" });
    });

    it("refuses the set when no tenant set is declared", () => {
      expect(checkTenantScope({ sql: read, params: fence.params, tenantId: AGG })).toEqual({
        kind: "missing-predicate",
      });
    });
  });
});

describe("statement checks read text the way ClickHouse lexes it (GUARD-F1-F3)", () => {
  const ONE = "TenantId = {t:String}";
  const SET = "TenantId IN ({all:Array(String)})";
  const one = (where: string) =>
    checkTenantScope({ sql: `SELECT * FROM t WHERE ${where}`, params: { t: AGG }, tenantId: AGG });
  const set = (where: string) =>
    checkTenantScope({
      sql: `SELECT * FROM t WHERE ${where}`,
      params: { all: [AGG, member(0)] },
      tenantId: AGG,
      tenantIds: [AGG, member(0)],
    });

  describe("given text ClickHouse reads as a comment or a heredoc string", () => {
    it.each([
      ["a `# ` line comment", `1 = 1 # ${ONE}`],
      ["a `#!` line comment", `1 = 1 #! ${ONE}`],
      ["a `$$` heredoc", `$$ ${ONE} $$ != ''`],
      ["a `$tag$` heredoc", `$q_1$ ${ONE} $q_1$ != ''`],
      ["a nested block comment", `1 = 1 /* /* */ AND ${ONE} */`],
    ])("refuses a predicate hidden in %s", (_label, where) => {
      expect(one(where)).toEqual({ kind: "missing-predicate" });
      expect(set(where.replace(ONE, SET))).toEqual({ kind: "missing-predicate" });
    });

    it.each([
      ["a `# ` line comment", `${ONE} # (\n OR 1 = 1`],
      ["a heredoc", `${ONE} AND $t$ ( $t$ = $t$ ( $t$ OR 1 = 1`],
    ])("refuses an OR a bracket inside %s cannot lift", (_label, where) => {
      expect(one(where)).toEqual({ kind: "weakening-disjunction" });
      expect(set(where.replace(ONE, SET))).toEqual({ kind: "weakening-disjunction" });
    });

    it("reads `$` inside an identifier as code, and a heredoc beside the predicate as a string", () => {
      const sql = (where: string) => `SELECT a$t$ FROM t WHERE ${ONE} ${where}`;
      const check = (where: string) =>
        checkTenantScope({ sql: sql(where), params: { t: AGG }, tenantId: AGG });
      expect(check("AND b = $t$x OR 1 = 1$t$")).toBeNull();
      expect(check("OR a$t$ = 1")).toEqual({ kind: "weakening-disjunction" });
    });
  });

  describe("given a tenant predicate wrapped in something that can cancel it", () => {
    it.each([
      ["compared, bracketed", "(PRED) = 0"],
      ["compared, bare", "PRED = 0"],
      ["compared with IN", "(PRED) IN (0, 1)"],
      ["tested with IS NOT NULL", "(PRED) IS NOT NULL"],
      ["tested with IS NULL, bare", "PRED IS NULL"],
      ["in if()", "if(PRED, 1, 1)"],
      ["in xor()", "xor(PRED, 1)"],
      ["in isNotNull()", "isNotNull(PRED)"],
      ["under a ternary", "x = 1 AND PRED ? 1 : 1"],
      ["as a BETWEEN bound", "1 NOT BETWEEN 5 AND PRED"],
      ["in a compared conjunction", "(x = 1 AND PRED) = 0"],
      ["in a CASE", "CASE WHEN PRED THEN 1 ELSE 1 END = 1"],
    ])("refuses it %s", (_label, where) => {
      expect(one(where.replace("PRED", ONE))).toEqual({ kind: "predicate-not-and-term" });
      expect(set(where.replace("PRED", SET))).toEqual({ kind: "predicate-not-and-term" });
    });

    it.each([
      ["followed by clauses", "PRED AND x = 1 ORDER BY x LIMIT 1"],
      ["alias-qualified, an OR bracketed beneath it", "t.PRED AND (a OR b)"],
      ["after a BETWEEN", "x BETWEEN 1 AND 2 AND PRED"],
      ["beside a bracketed ternary", "PRED AND (x ? 1 : 0) = 1"],
      ["in a bracketed conjunction", "(x = 1 AND PRED) GROUP BY x"],
      ["chained comparisons beside it", "PRED AND x = 1 = 0"],
    ])("accepts it as a plain AND term %s", (_label, where) => {
      expect(one(where.replace("PRED", ONE))).toBeNull();
      expect(set(where.replace("PRED", SET))).toBeNull();
    });

    it("accepts it in PREWHERE and in a subquery's WHERE", () => {
      const prewhere = `SELECT * FROM t PREWHERE ${ONE} WHERE x = 1`;
      const subquery = `SELECT * FROM (SELECT x FROM t WHERE ${ONE}) GROUP BY x`;
      for (const sql of [prewhere, subquery]) {
        expect(checkTenantScope({ sql, params: { t: AGG }, tenantId: AGG })).toBeNull();
      }
    });
  });
});

describe("every scope that reads a table binds the tenant itself (GUARD-F2)", () => {
  const params = { t: AGG, all: [AGG, member(0)], other: OUTSIDE };
  const one = (sql: string) =>
    checkTenantScope({
      sql: sql.replaceAll("PRED", "TenantId = {t:String}"),
      params,
      tenantId: AGG,
    });
  const set = (sql: string) =>
    checkTenantScope({
      sql: sql.replaceAll("PRED", "TenantId IN ({all:Array(String)})"),
      params,
      tenantId: AGG,
      tenantIds: [AGG, member(0)],
    });

  describe("given a scope its predicate does not reach", () => {
    it.each([
      ["a UNION arm without it", "SELECT a FROM t WHERE PRED UNION ALL SELECT a FROM t"],
      [
        "a UNION arm bound to another tenant",
        "SELECT a FROM t WHERE PRED UNION ALL SELECT a FROM t WHERE TenantId = {other:String}",
      ],
      ["a scalar subquery", "SELECT (SELECT groupArray(S) FROM t) FROM t WHERE PRED"],
      [
        "the outer read, the tenant only in a subquery",
        "SELECT * FROM t WHERE Id IN (SELECT Id FROM u WHERE PRED)",
      ],
      ["a joined table", "SELECT u.S FROM t JOIN u ON t.Id = u.Id WHERE t.PRED"],
      [
        "the read beside NOT EXISTS",
        "SELECT * FROM t WHERE NOT EXISTS (SELECT 1 FROM u WHERE PRED)",
      ],
      ["the read, its predicate in ORDER BY after an AND", "SELECT * FROM t ORDER BY x AND PRED"],
      [
        "a RIGHT JOIN bound only in its ON",
        "SELECT * FROM t RIGHT JOIN u ON u.PRED AND u.Id = t.Id WHERE t.PRED",
      ],
      [
        "a join after a derived table, the predicate bare",
        "SELECT * FROM (SELECT 1 AS Id) d JOIN u ON d.Id = u.Id WHERE PRED",
      ],
      [
        "a table a subquery's CTE name shadows",
        "SELECT * FROM u WHERE Id IN (WITH u AS (SELECT Id FROM t WHERE PRED) SELECT Id FROM u)",
      ],
      ["a comma join", "SELECT * FROM t, u WHERE PRED"],
      ["the altered table", "ALTER TABLE t DELETE WHERE Id IN (SELECT Id FROM t WHERE PRED)"],
      [
        "a join qualified by a quoted alias",
        "SELECT * FROM t JOIN u ON t.Id = u.Id WHERE t.PRED AND `u`.PRED",
      ],
    ])("refuses %s", (_label, sql) => {
      expect(one(sql)).toEqual({ kind: "unbound-read" });
      expect(set(sql)).toEqual({ kind: "unbound-read" });
    });

    it("refuses a predicate only in the projection", () => {
      expect(one("SELECT PRED AS mine, * FROM t")).toEqual({ kind: "predicate-not-and-term" });
      expect(set("SELECT PRED AS mine, * FROM t")).toEqual({ kind: "predicate-not-and-term" });
    });
  });

  describe("given every read bound in its own scope", () => {
    it.each([
      ["both UNION arms", "SELECT a FROM t WHERE PRED UNION ALL SELECT a FROM u WHERE PRED"],
      ["a scalar subquery", "SELECT (SELECT groupArray(S) FROM u WHERE PRED) FROM t WHERE PRED"],
      [
        "a join bound in its ON",
        "SELECT b.S FROM t AS a INNER JOIN u b ON b.PRED AND a.Id = b.Id WHERE a.PRED",
      ],
      [
        "a left join bound in WHERE",
        "SELECT * FROM t LEFT JOIN u ON t.Id = u.Id WHERE t.PRED AND u.PRED",
      ],
      [
        "a join to a bound subquery",
        "SELECT * FROM t JOIN (SELECT Id FROM u WHERE PRED) AS s ON t.Id = s.Id WHERE PRED",
      ],
      [
        "NOT EXISTS beside it",
        "SELECT * FROM t WHERE PRED AND NOT EXISTS (SELECT 1 FROM u WHERE PRED)",
      ],
      ["a CTE", "WITH s AS (SELECT Id FROM u WHERE PRED) SELECT * FROM s"],
      [
        "a CTE the union's later arm reads",
        "WITH s AS (SELECT Id FROM u WHERE PRED) SELECT (SELECT 1 FROM s) UNION ALL SELECT (SELECT 2 FROM s)",
      ],
      [
        "a union of bracketed reads of a CTE",
        "WITH p AS (SELECT * FROM t FINAL WHERE PRED) SELECT * FROM ((SELECT p.* FROM p) UNION ALL (SELECT p.* FROM p LIMIT 1))",
      ],
      [
        "ARRAY JOIN and WITH FILL",
        "SELECT * FROM t ARRAY JOIN E AS e WHERE PRED ORDER BY d WITH FILL FROM toDate(0) TO toDate(1)",
      ],
      ["the altered table", "ALTER TABLE t DELETE WHERE PRED"],
      ["a read qualified by its table name", "SELECT * FROM db.t WHERE t.PRED"],
    ])("accepts %s", (_label, sql) => {
      expect(one(sql)).toBeNull();
      expect(set(sql)).toBeNull();
    });
  });
});
