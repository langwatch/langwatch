import {
  type Authorization,
  type AuthorizationInput,
  BRAID_CONDITION_MAX_LENGTH,
  BRAID_CONDITION_MAX_TERMS,
  BRAID_MAX_DISTINCT_CONDITIONS,
  type BraidConditionTerm,
  type CompiledWhere,
  narrowAuthorization,
  sealAuthorization,
} from "@langwatch/authorization";
import { tenantScope, tenantScopeWithConditions, tenantSet } from "@langwatch/clickhouse-markers";
import { describe, expect, it, vi } from "vitest";

import {
  AuthorizedClickHouse,
  conditionsExpression,
  expandFragment,
  expandStatement,
  fenceExpression,
  fenceFor,
  tenantScopeKey,
} from "../authorized-reads.ts";
import { ClickHouseQueryClient } from "../client.ts";
import type { QueryDriver, QueryRequest } from "../query.ts";
import { STATEMENT_BYTE_BUDGET } from "../statementBudget.ts";
import { StatementScopeError } from "../statementScopeError.ts";
/**
 * ADR-183 §3: a span read applies each braid's compiled condition through the conditions marker
 * on its outer select, owner-bound and fully parameter-bound, and refuses a statement that would
 * read a braid owner's spans without it. Spec: modules/trace/specs/braided-spans.feature
 */
import { checkTenantScope, TenantGuard } from "../tenantGuard.ts";

const NOW = 1_800_000_000_000;
const READER = "proj_reader";
const OWNER = "proj_owner";
const OTHER_OWNER = "proj_other_owner";
const AGG = "proj_aggregate";
const MEMBER = "proj_member";

type GrantInput = AuthorizationInput["grants"][number];

const compiled = (...terms: BraidConditionTerm[]): CompiledWhere => ({
  version: 1,
  tree: terms.length === 1 && terms[0] ? terms[0] : { kind: "and", terms },
});

const WEB = compiled({ kind: "attributeEquals", on: "span", key: "orchestrator", value: "web" });
const CLI = compiled({ kind: "nameEquals", value: "cli_agent" });

const own = (projectId = READER): GrantInput => ({
  projectId,
  permissions: ["traces:view", "analytics:view"],
  via: [],
  kind: "own",
});

const braid = ({
  owner = OWNER,
  compiledWhere = WEB,
  from = 0,
  until = null,
}: {
  owner?: string;
  compiledWhere?: CompiledWhere | undefined;
  from?: number;
  until?: number | null;
}): GrantInput => ({
  projectId: owner,
  permissions: ["traces:view"],
  via: [`grant_${owner}_${from}`],
  kind: "shared",
  condition: {
    type: "span",
    ...(compiledWhere === undefined ? {} : { where: "compiled", compiledWhere }),
    from,
    until,
  },
});

const memberWindow: GrantInput = {
  projectId: MEMBER,
  permissions: ["traces:view"],
  via: ["grant_member"],
  kind: "shared",
  condition: { type: "trace", from: NOW - 1000, until: null },
};

const proof = (grants: GrantInput[]): Authorization =>
  sealAuthorization({
    actor: { type: "user", id: "ana" },
    principal: { type: "user", id: "ana" },
    scope: { organizationId: "org_acme" },
    grants,
    expiresAt: NOW + 30_000,
    purpose: { kind: "route", route: "traces.get" },
  });

/** A span read in the shape the trace repositories use: latest version elected inside. */
const spanRead = (outer: string) =>
  `SELECT SpanId, SpanName FROM stored_spans WHERE ${outer} AND TraceId = {traceId:String}` +
  ` AND (TenantId, TraceId, SpanId, UpdatedAt) IN (SELECT TenantId, TraceId, SpanId, max(UpdatedAt)` +
  ` FROM stored_spans WHERE ${tenantScope("StartTime")} AND TraceId = {traceId:String}` +
  ` GROUP BY TenantId, TraceId, SpanId)`;

const LATEST_VERSION_SUBQUERY = "(SELECT TenantId, TraceId, SpanId, max(UpdatedAt)";

const expandSpanRead = (
  authorization: Authorization,
  outer = tenantScopeWithConditions("StartTime"),
) =>
  expandStatement({
    query: spanRead(outer),
    queryParams: { traceId: "tr-1" },
    fence: fenceFor({ authorization, reads: "spans" }),
  });

/** The routed client over a driver spy, as `authorized-reads.unit.test.ts` builds it. */
function clientWith() {
  const execute = vi.fn<QueryDriver["execute"]>().mockResolvedValue({ rows: [] });
  const client = new ClickHouseQueryClient({
    tenantGuard: new TenantGuard(),
    driver: { execute, insert: async () => {}, command: async () => {} },
  });
  const sent = (): QueryRequest => {
    const request = execute.mock.calls[0]?.[0];
    if (request === undefined) throw new Error("no statement was sent");
    return request;
  };
  return {
    execute,
    sent,
    clickhouse: new AuthorizedClickHouse({
      resolveClient: vi.fn().mockResolvedValue(client),
      now: () => NOW,
    }),
  };
}

const scopeErrorOf = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    if (error instanceof StatementScopeError) return error.violation;
    throw error;
  }
  throw new Error("nothing was refused");
};

describe("the fence over a span read", () => {
  describe("given a proof with no braids", () => {
    const proofs = { plain: proof([own()]), aggregate: proof([own(AGG), memberWindow]) };

    it("fences a span read exactly as a trace read, at either marker", () => {
      for (const authorization of Object.values(proofs)) {
        const traces = fenceFor({ authorization, reads: "traces" });
        const spans = fenceFor({ authorization, reads: "spans" });

        expect(spans).toEqual(traces);
        expect(conditionsExpression({ fence: spans, column: "StartTime" })).toEqual(
          fenceExpression({ fence: traces, column: "StartTime" }),
        );
        expect(tenantScopeKey({ authorization, reads: "spans" })).toBe(
          tenantScopeKey({ authorization, reads: "traces" }),
        );
      }
    });
  });

  describe("given a reader holding braids", () => {
    const authorization = proof([own(), braid({}), braid({ compiledWhere: CLI, from: 5 })]);

    describe("when a trace, analytics or log-shaped read is fenced", () => {
      it("leaves every braid out, since a span window opens span reads alone", () => {
        expect(fenceFor({ authorization, reads: "traces" })).toEqual({ own: [READER], shared: [] });
        expect(fenceFor({ authorization, reads: "analytics" })).toEqual({
          own: [READER],
          shared: [],
        });
        expect(tenantScopeKey({ authorization, reads: "traces" })).toBe(READER);
      });
    });

    describe("when two braids on one owner are rendered", () => {
      it("renders their union: one owner-bound clause per predicate, joined by the fence's OR", () => {
        const { sql, params } = conditionsExpression({
          fence: fenceFor({ authorization, reads: "spans" }),
          column: "StartTime",
        });

        const window = (n: number) => {
          const ids = `{tenantScope_c${n}_ids:Array(String)}`;
          const edge = (name: string) =>
            `transform(TenantId, ${ids}, {tenantScope_c${n}_${name}:Array(Int64)}, toInt64(0))`;
          return (
            `TenantId IN (${ids}) AND StartTime >= fromUnixTimestamp64Milli(${edge("from")})` +
            ` AND (${edge("until")} = 0 OR StartTime < fromUnixTimestamp64Milli(${edge("until")}))`
          );
        };
        expect(sql).toBe(
          `(TenantId IN ({tenantScope_all:Array(String)}) AND (TenantId IN ({tenantScope_own:Array(String)})` +
            ` OR (${window(0)} AND (SpanAttributes[{tenantScope_c0_0k:String}] = {tenantScope_c0_0v:String}))` +
            ` OR (${window(1)} AND (SpanName = {tenantScope_c1_0v:String}))))`,
        );
        expect(params).toEqual({
          tenantScope_all: [READER, OWNER],
          tenantScope_own: [READER],
          tenantScope_c0_ids: [OWNER],
          tenantScope_c0_from: [0],
          tenantScope_c0_until: [0],
          tenantScope_c0_0k: "orchestrator",
          tenantScope_c0_0v: "web",
          tenantScope_c1_ids: [OWNER],
          tenantScope_c1_from: [5],
          tenantScope_c1_until: [0],
          tenantScope_c1_0v: "cli_agent",
        });
      });

      it("is admitted by the tenant guard as the reader's declared set", () => {
        const expanded = expandSpanRead(authorization);

        expect(
          checkTenantScope({
            sql: expanded.query,
            params: expanded.queryParams,
            tenantId: READER,
            tenantIds: [READER, OWNER],
          }),
        ).toBeNull();
      });
    });

    describe("when the span read is expanded", () => {
      it("applies the condition after the latest-version subquery, never inside it", () => {
        const { query } = expandSpanRead(authorization);
        const inner = query.slice(query.indexOf(LATEST_VERSION_SUBQUERY));

        expect(query.indexOf(LATEST_VERSION_SUBQUERY)).toBeGreaterThan(
          query.indexOf("SpanAttributes["),
        );
        expect(inner).not.toMatch(/SpanAttributes|SpanName =|tenantScope_c\d/);
        expect(inner).toContain("{tenantScope_ids:Array(String)}");
      });

      it("writes no condition literal or key into the statement text", () => {
        const secret = compiled(
          { kind: "attributeEquals", on: "resource", key: "secret.key", value: "secret-value" },
          { kind: "attributePresent", key: "secret.present" },
          { kind: "verified", key: "secret.signed" },
        );
        const { query, queryParams } = expandSpanRead(
          proof([own(), braid({ compiledWhere: secret })]),
        );

        expect(query).not.toMatch(/secret|langwatch\.reserved/);
        expect(query).toContain("ResourceAttributes[{tenantScope_c0_0k:String}]");
        expect(query).toContain("mapContains(SpanAttributes, {tenantScope_c0_1k:String})");
        expect(query).toContain(
          "SpanAttributes[{tenantScope_c0_2k:String}] = {tenantScope_reader:String}",
        );
        expect(queryParams).toMatchObject({
          tenantScope_c0_0k: "secret.key",
          tenantScope_c0_0v: "secret-value",
          tenantScope_c0_1k: "secret.present",
          tenantScope_c0_2k: "langwatch.reserved.verified.secret.signed",
          tenantScope_reader: READER,
        });
      });

      it("sends it through the routed client with the owner in its declared tenant set", async () => {
        const { sent, clickhouse } = clientWith();

        await clickhouse.as(authorization, { reads: "spans" }).query({
          query: spanRead(tenantScopeWithConditions("StartTime")),
          query_params: { traceId: "tr-1" },
        });

        expect(sent().tenantId).toBe(READER);
        expect(sent().tenantIds).toEqual([READER, OWNER]);
        expect(sent().sql).toContain("SpanAttributes[{tenantScope_c0_0k:String}]");
      });
    });

    describe("when a statement or fragment carries no conditions marker", () => {
      it("refuses the statement and sends nothing", async () => {
        const { execute, clickhouse } = clientWith();
        const reader = clickhouse.as(authorization, { reads: "spans" });

        await expect(
          reader.query({
            query: spanRead(tenantScope("StartTime")),
            query_params: { traceId: "tr-1" },
          }),
        ).rejects.toMatchObject({ violation: { kind: "missing-condition-marker" } });
        expect(execute).not.toHaveBeenCalled();
      });

      it("refuses it for a braid with no condition too, whose windows only that marker applies exactly", () => {
        const empty = proof([own(), braid({ compiledWhere: undefined })]);

        expect(scopeErrorOf(() => expandSpanRead(empty, tenantScope("StartTime")))).toEqual({
          kind: "missing-condition-marker",
        });
      });

      it("refuses a fragment that reaches the fence without it", () => {
        const fence = fenceFor({ authorization, reads: "spans" });

        expect(
          scopeErrorOf(() =>
            expandFragment({
              fragment: `TraceId IN (SELECT TraceId FROM x WHERE ${tenantSet()})`,
              queryParams: {},
              fence,
            }),
          ),
        ).toEqual({ kind: "missing-condition-marker" });
      });
    });

    describe("when the cache key is taken", () => {
      it("changes with a braid's tree and compiler version, and holds for the same proof", () => {
        const key = (grants: GrantInput[]) =>
          tenantScopeKey({ authorization: proof(grants), reads: "spans" });
        const base = key([own(), braid({})]);

        expect(key([own(), braid({})])).toBe(base);
        expect(key([own(), braid({ compiledWhere: CLI })])).not.toBe(base);
        expect(key([own(), braid({ compiledWhere: { ...WEB, version: 2 } })])).not.toBe(base);
        expect(key([own(), braid({ from: 7 })])).not.toBe(base);
      });
    });
  });

  describe("given two braids on one owner with one predicate", () => {
    it("merges overlapping windows into one clause", () => {
      const fence = fenceFor({
        authorization: proof([
          own(),
          braid({ from: 0, until: 100 }),
          braid({ from: 50, until: null }),
        ]),
        reads: "spans",
      });

      expect(fence.braids?.clauses.map((clause) => clause.windows)).toEqual([
        [{ projectId: OWNER, from: 0, until: null }],
      ]);
    });

    it("keeps disjoint windows exact, one clause each, and the tenant marker on their span", () => {
      const fence = fenceFor({
        authorization: proof([
          own(),
          braid({ from: 300, until: 400 }),
          braid({ from: 0, until: 100 }),
          braid({ owner: OTHER_OWNER }),
        ]),
        reads: "spans",
      });

      expect(fence.braids?.clauses.map((clause) => clause.windows)).toEqual([
        [
          { projectId: OWNER, from: 0, until: 100 },
          { projectId: OTHER_OWNER, from: 0, until: null },
        ],
        [{ projectId: OWNER, from: 300, until: 400 }],
      ]);
      expect(fence.shared).toEqual([
        { projectId: OWNER, from: 0, until: 400 },
        { projectId: OTHER_OWNER, from: 0, until: null },
      ]);
    });
  });

  describe("given a proof narrowed for a detail read", () => {
    const authorization = proof([own(), braid({})]);

    it("keeps the braids when narrowed to the reader's own project", () => {
      const narrowed = narrowAuthorization({ authorization, projectId: READER });

      expect(
        narrowed && fenceFor({ authorization: narrowed, reads: "spans" }).braids?.clauses,
      ).toHaveLength(1);
    });
  });

  describe("given a braid compiled by a compiler this reader does not know", () => {
    it("refuses the statement by name rather than read the owner's spans unconditioned", () => {
      const future = proof([own(), braid({ compiledWhere: { ...WEB, version: 99 } })]);

      expect(scopeErrorOf(() => expandSpanRead(future))).toEqual({
        kind: "unsupported-condition-version",
        version: 99,
      });
    });
  });

  describe("given the largest legal proof", () => {
    const longest = (seed: number): CompiledWhere => {
      const width = Math.floor(BRAID_CONDITION_MAX_LENGTH / (2 * BRAID_CONDITION_MAX_TERMS));
      const text = (term: number, side: string) => `${seed}-${term}-${side}-`.padEnd(width, "x");
      return compiled(
        ...Array.from({ length: BRAID_CONDITION_MAX_TERMS }, (_, term) => ({
          kind: "attributeEquals" as const,
          on: "resource" as const,
          key: text(term, "k"),
          value: text(term, "v"),
        })),
      );
    };
    const grants = Array.from({ length: BRAID_MAX_DISTINCT_CONDITIONS }, (_, index) =>
      braid({ owner: `proj_owner_${index}`, compiledWhere: longest(index), from: index }),
    );

    it("renders its span read within the statement budget", () => {
      const { query } = expandSpanRead(proof([own(), ...grants]));

      expect(query.match(/ResourceAttributes\[/g)).toHaveLength(
        BRAID_MAX_DISTINCT_CONDITIONS * BRAID_CONDITION_MAX_TERMS,
      );
      expect(Buffer.byteLength(query, "utf8")).toBeLessThanOrEqual(STATEMENT_BYTE_BUDGET);
    });
  });

  describe("given an expanded statement over the budget", () => {
    it("refuses it by name before anything is sent", () => {
      const padding = "x".repeat(STATEMENT_BYTE_BUDGET);

      expect(
        scopeErrorOf(() =>
          expandStatement({
            query: `SELECT 1 FROM stored_spans WHERE ${tenantScope("StartTime")} AND Name = {name:String} -- ${padding}`,
            queryParams: { name: "n" },
            fence: fenceFor({ authorization: proof([own()]), reads: "spans" }),
          }),
        ),
      ).toMatchObject({ kind: "over-budget", budget: STATEMENT_BYTE_BUDGET });
    });
  });
});
