import {
  type Authorization,
  AuthorizationExpiredError,
  type AuthorizationInput,
  BRAID_CONDITION_EVERY_SPAN,
  BRAID_CONDITION_MAX_LENGTH,
  BRAID_CONDITION_MAX_TERMS,
  BRAID_MAX_DISTINCT_CONDITIONS,
  type BraidConditionTerm,
  type CompiledWhere,
  honourSpanBraids,
  narrowAuthorization,
  sealAuthorization,
  SPAN_BRAID_PERMISSION,
} from "@langwatch/authorization";
import {
  tenantScope,
  tenantScopeForLatestVersion,
  tenantScopeWithConditions,
  tenantSet,
} from "@langwatch/clickhouse-markers";
import { describe, expect, it, vi } from "vitest";

import {
  AuthorizedClickHouse,
  conditionsExpression,
  expandFragment,
  expandStatement,
  fenceExpression,
  fenceFor,
  READ_RESOURCES,
  type ReadResource,
  tenantScopeKey,
} from "../authorized-reads.ts";
import { ClickHouseQueryClient } from "../client.ts";
import type { QueryDriver, QueryRequest } from "../query.ts";
import {
  CLICKHOUSE_HTTP_MAX_FIELDS,
  STATEMENT_BYTE_BUDGET,
  STATEMENT_PARAM_BUDGET,
} from "../statementBudget.ts";
import { StatementScopeError } from "../statementScopeError.ts";
/**
 * ADR-201 §3: a span read applies each braid's compiled condition through the conditions marker
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
  compiledWhere?: CompiledWhere;
  from?: number;
  until?: number | null;
}): GrantInput => ({
  projectId: owner,
  permissions: [SPAN_BRAID_PERMISSION],
  via: [`grant_${owner}_${from}`],
  kind: "shared",
  condition: {
    type: "span",
    ...(compiledWhere === BRAID_CONDITION_EVERY_SPAN ? {} : { where: "compiled" }),
    compiledWhere,
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

/** The route's proof, before the trace module's plan check has honoured any braid. */
const unhonoured = (grants: GrantInput[]): Authorization =>
  sealAuthorization({
    actor: { type: "user", id: "ana" },
    principal: { type: "user", id: "ana" },
    scope: { organizationId: "org_acme" },
    grants,
    expiresAt: NOW + 30_000,
    purpose: { kind: "route", route: "traces.get" },
  });

/** The proof as the Enterprise plan check hands it to a span read. */
const proof = (grants: GrantInput[]): Authorization =>
  honourSpanBraids({ authorization: unhonoured(grants) });

const READ_RESOURCE_NAMES = Object.keys(READ_RESOURCES) as ReadResource[];

/** An own or trace grant carrying every proof-bearing permission a route may mint for. */
const everyRead = (grant: GrantInput): GrantInput => ({
  ...grant,
  permissions: ["traces:view", "analytics:view", "cost:view"],
});

/** A span read in the shape the trace repositories use: latest version elected inside. */
const spanRead = (outer: string) =>
  `SELECT SpanId, SpanName FROM stored_spans WHERE ${outer} AND TraceId = {traceId:String}` +
  ` AND (TenantId, TraceId, SpanId, UpdatedAt) IN (SELECT TenantId, TraceId, SpanId, max(UpdatedAt)` +
  ` FROM stored_spans WHERE ${tenantScopeForLatestVersion("StartTime")} AND TraceId = {traceId:String}` +
  ` GROUP BY TenantId, TraceId, SpanId)`;

const LATEST_VERSION_SUBQUERY = "(SELECT TenantId, TraceId, SpanId, max(UpdatedAt)";

/** The held-trace semi-join the fence renders, narrowed as the read's marker names. */
const held = (narrowed = "") =>
  `TraceId IN (SELECT TraceId FROM stored_spans WHERE TenantId IN ({tenantScope_own:Array(String)})` +
  ` AND StartTime >= fromUnixTimestamp64Milli({tenantScope_heldFrom:Int64})${narrowed})`;

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

  describe("given a proof whose braids the plan check never honoured", () => {
    const braids = [braid({}), braid({ compiledWhere: CLI, from: 5 })];
    const authorization = unhonoured([everyRead(own()), everyRead(memberWindow), ...braids]);
    const withoutBraids = unhonoured([everyRead(own()), everyRead(memberWindow)]);

    /** @scenario "A proof the plan check never honoured shows no braided spans in any read" */
    it("fences every read resource as if it carried no braid", () => {
      for (const reads of READ_RESOURCE_NAMES) {
        const fence = fenceFor({ authorization, reads });

        expect(fence.braids).toBeUndefined();
        expect(fence).toEqual(fenceFor({ authorization: withoutBraids, reads }));
        expect(tenantScopeKey({ authorization, reads })).toBe(
          tenantScopeKey({ authorization: withoutBraids, reads }),
        );
      }
    });

    it("sends a span read with no owner in its tenant set or its statement", async () => {
      const { sent, clickhouse } = clientWith();

      await clickhouse.as(authorization, { reads: "spans" }).query({
        query: spanRead(tenantScopeWithConditions("StartTime")),
        query_params: { traceId: "tr-1" },
      });

      expect(sent().tenantIds).toEqual([READER, MEMBER]);
      expect(sent().sql).not.toMatch(/SpanAttributes\[|SpanName =|tenantScope_c\d/);
      expect(Object.values(sent().params ?? {}).flat()).not.toContain(OWNER);
    });

    it("keeps braids out once narrowed to the reader's own project", () => {
      const narrowed = narrowAuthorization({ authorization, projectId: READER });

      expect(narrowed && fenceFor({ authorization: narrowed, reads: "spans" }).braids).toBe(
        undefined,
      );
    });
  });

  describe("given the same proof once the plan check honoured it", () => {
    /** @scenario "A proof the plan check honoured shows the braided spans" */
    it("adds the braids to a span read alone", () => {
      const authorization = proof([everyRead(own()), everyRead(memberWindow), braid({})]);

      for (const reads of READ_RESOURCE_NAMES) {
        const clauses = fenceFor({ authorization, reads }).braids?.clauses ?? [];
        expect({ reads, braided: clauses.length > 0 }).toEqual({
          reads,
          braided: reads === "spans",
        });
      }
      expect(fenceFor({ authorization, reads: "spans" }).shared).toContainEqual(
        expect.objectContaining({ projectId: OWNER }),
      );
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
            ` OR (${held()} AND ((${window(0)} AND (SpanAttributes[{tenantScope_p0_k:Array(String)}[1]] = {tenantScope_p0_v:Array(String)}[1]))` +
            ` OR (${window(1)} AND (SpanName = {tenantScope_p1_v:Array(String)}[1]))))))`,
        );
        expect(params).toEqual({
          tenantScope_all: [READER, OWNER],
          tenantScope_own: [READER],
          tenantScope_c0_ids: [OWNER],
          tenantScope_c0_from: [0],
          tenantScope_c0_until: [0],
          tenantScope_p0_k: ["orchestrator"],
          tenantScope_p0_v: ["web"],
          tenantScope_c1_ids: [OWNER],
          tenantScope_c1_from: [5],
          tenantScope_c1_until: [0],
          tenantScope_p1_v: ["cli_agent"],
          tenantScope_heldFrom: 0,
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
        expect(inner).not.toMatch(/SpanAttributes|SpanName =|tenantScope_[cp]\d/);
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
        expect(query).toContain(
          "ResourceAttributes[{tenantScope_p0_k:Array(String)}[1]] = {tenantScope_p0_v:Array(String)}[1]",
        );
        expect(query).toContain("mapContains(SpanAttributes, {tenantScope_p0_k:Array(String)}[2])");
        expect(query).toContain(
          "mapContains(SpanAttributes, {tenantScope_p0_k:Array(String)}[3]) AND SpanAttributes[{tenantScope_p0_k:Array(String)}[4]] = {tenantScope_reader:String}",
        );
        expect(queryParams).toMatchObject({
          tenantScope_p0_k: [
            "secret.key",
            "secret.present",
            "secret.signed",
            "langwatch.reserved.verified.secret.signed",
          ],
          tenantScope_p0_v: ["secret-value"],
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
        expect(sent().sql).toContain("SpanAttributes[{tenantScope_p0_k:Array(String)}[1]]");
      });
    });

    describe("when a statement or fragment carries a plain tenant marker", () => {
      /** @scenario "A plain tenant marker under a braids fence is refused" */
      it("refuses the statement and sends nothing", async () => {
        const { execute, clickhouse } = clientWith();
        const reader = clickhouse.as(authorization, { reads: "spans" });

        await expect(
          reader.query({
            query: spanRead(tenantScope("StartTime")),
            query_params: { traceId: "tr-1" },
          }),
        ).rejects.toMatchObject({ violation: { kind: "plain-marker-under-braids" } });
        expect(execute).not.toHaveBeenCalled();
      });

      it("refuses the set-only marker beside the conditions marker", () => {
        const fence = fenceFor({ authorization, reads: "spans" });

        expect(
          scopeErrorOf(() =>
            expandStatement({
              query: `${spanRead(tenantScopeWithConditions("StartTime"))} AND x IN (SELECT x FROM evals WHERE ${tenantSet()})`,
              queryParams: { traceId: "tr-1" },
              fence,
            }),
          ),
        ).toEqual({ kind: "plain-marker-under-braids" });
      });

      it("accepts both plain markers on a proof with no braids", () => {
        const { query } = expandStatement({
          query: `SELECT 1 FROM stored_spans WHERE ${tenantScope("StartTime")} AND x IN (SELECT x FROM evals WHERE ${tenantSet()})`,
          queryParams: {},
          fence: fenceFor({ authorization: proof([own()]), reads: "spans" }),
        });

        expect(query).not.toContain("{{");
      });

      it("refuses a fragment that reaches the fence through one", () => {
        const fence = fenceFor({ authorization, reads: "spans" });

        expect(
          scopeErrorOf(() =>
            expandFragment({
              fragment: `TraceId IN (SELECT TraceId FROM x WHERE ${tenantSet()})`,
              queryParams: {},
              fence,
            }),
          ),
        ).toEqual({ kind: "plain-marker-under-braids" });
      });
    });

    describe("when the owner's spans are fenced to traces the reader holds", () => {
      /** @scenario "The fence shows owner spans only in traces the reader holds" */
      it("puts every braid clause under one semi-join on the reader's own spans", () => {
        const { query, queryParams } = expandSpanRead(authorization);

        expect(query.match(/TraceId IN \(SELECT TraceId FROM stored_spans/g)).toHaveLength(1);
        expect(query).toContain(`OR (${held()} AND ((TenantId IN ({tenantScope_c0_ids`);
        expect(queryParams).toMatchObject({ tenantScope_own: [READER], tenantScope_heldFrom: 0 });
      });

      it("binds the semi-join's lower bound to the earliest braid window", () => {
        const fence = fenceFor({
          authorization: proof([
            own(),
            braid({ from: 70 }),
            braid({ compiledWhere: CLI, from: 30 }),
          ]),
          reads: "spans",
        });

        expect(conditionsExpression({ fence, column: "StartTime" }).params).toMatchObject({
          tenantScope_heldFrom: 30,
        });
      });

      it("narrows the semi-join by the read's trace id or its own lower bound", () => {
        const fence = fenceFor({ authorization, reads: "spans" });
        const narrowed = (marker: string) =>
          expandStatement({
            query: `SELECT SpanId FROM stored_spans WHERE ${marker}`,
            queryParams: { traceId: "tr-1", sinceMs: 5 },
            fence,
          }).query;

        expect(narrowed(tenantScopeWithConditions("StartTime", { traceId: "traceId" }))).toContain(
          held(" AND TraceId = {traceId:String}"),
        );
        expect(narrowed(tenantScopeWithConditions("StartTime", { sinceMs: "sinceMs" }))).toContain(
          held(" AND StartTime >= fromUnixTimestamp64Milli({sinceMs:Int64})"),
        );
      });

      it("refuses a semi-join bound named with a reserved prefix", () => {
        expect(
          scopeErrorOf(() =>
            expandSpanRead(
              authorization,
              tenantScopeWithConditions("StartTime", { traceId: "tenantScope_own" }),
            ),
          ),
        ).toEqual({ kind: "reserved-param", param: "tenantScope_own" });
      });

      it("leaves a trace window beside the braids outside the semi-join", () => {
        const { sql } = conditionsExpression({
          fence: fenceFor({
            authorization: proof([own(), memberWindow, braid({})]),
            reads: "spans",
          }),
          column: "StartTime",
        });

        expect(sql.indexOf("{tenantScope_c1_ids:Array(String)}")).toBeLessThan(
          sql.indexOf("TraceId IN (SELECT"),
        );
        expect(sql).toContain(`OR (${held()} AND ((TenantId IN ({tenantScope_c0_ids`);
      });
    });

    describe("when a latest-version marker is written", () => {
      const fence = fenceFor({ authorization, reads: "spans" });
      const refusalOf = (query: string) =>
        scopeErrorOf(() => expandStatement({ query, queryParams: { traceId: "tr-1" }, fence }));

      it("refuses it outside a latest-version election", () => {
        expect(
          refusalOf(
            `SELECT SpanId FROM stored_spans WHERE ${tenantScopeWithConditions("StartTime")}` +
              ` AND SpanId IN (SELECT SpanId FROM stored_spans WHERE ${tenantScopeForLatestVersion("StartTime")})`,
          ),
        ).toEqual({ kind: "loose-latest-version-marker" });
      });

      /** @scenario "A plain tenant marker under a braids fence is refused" */
      it("refuses an election whose select no windowed marker fences", () => {
        const election = spanRead("1 = 1").replace(" WHERE 1 = 1 AND", " WHERE");

        expect(
          refusalOf(
            `${election} AND 1 IN (SELECT 1 FROM stored_spans WHERE ${tenantScopeWithConditions("StartTime")})`,
          ),
        ).toEqual({ kind: "loose-latest-version-marker" });
        expect(
          refusalOf(
            `SELECT 1 FROM stored_spans WHERE ${tenantScopeWithConditions("StartTime")}` +
              ` UNION ALL ${election}`,
          ),
        ).toEqual({ kind: "loose-latest-version-marker" });
      });

      describe("when the election is not AND-ed into the fenced WHERE", () => {
        const head =
          "(TenantId, TraceId, SpanId, UpdatedAt) IN (SELECT TenantId, TraceId, SpanId, max(UpdatedAt)" +
          ` FROM stored_spans WHERE ${tenantScopeForLatestVersion("StartTime")} GROUP BY TenantId, TraceId, SpanId)`;
        const fenced = (between: string, after = "") =>
          `SELECT SpanId FROM stored_spans WHERE ${tenantScopeWithConditions("StartTime")}${between}${head}${after}`;

        /** @scenario "The latest-version election is only ever AND-ed into the fenced select" */
        it.each([
          ["a top-level OR", " OR ", ""],
          ["an OR after an AND-ed term", " AND TraceId = {traceId:String} OR ", ""],
          ["a NOT", " AND NOT ", ""],
          ["a NOT after an AND-ed term", " AND TraceId = {traceId:String} AND NOT ", ""],
          ["an OR in a group the election sits in", " AND (1 = 1 OR ", ")"],
          ["an OR inside a closed group, then a top-level OR", " AND (1 = 1 OR 1 = 2) OR ", ""],
          ["a BETWEEN whose upper bound is the election", " AND StartTime BETWEEN 1 AND ", ""],
          ["a comment", " AND 1 = 1 -- \n AND ", ""],
          ["no AND at all", " ", ""],
        ])("refuses %s before the election", (_shape, between, after) => {
          expect(refusalOf(fenced(between, after))).toEqual({
            kind: "loose-latest-version-marker",
          });
        });

        /** @scenario "The latest-version election is only ever AND-ed into the fenced select" */
        it.each([
          [
            "the trace id and its id bound",
            " AND TraceId = {traceId:String} {{idBound:stored_spans.TraceId:traceId}} AND ",
          ],
          ["one span id", " AND TraceId = {traceId:String} AND SpanId = {spanId:String} AND "],
          [
            "a span range",
            " AND TraceId = {traceId:String} AND StartTime >= fromUnixTimestamp64Milli({spanFromMs:Int64})" +
              " AND StartTime <= fromUnixTimestamp64Milli({spanToMs:Int64}) AND ",
          ],
          ["a since filter", " AND StartTime >= fromUnixTimestamp64Milli({sinceMs:Int64}) AND "],
          [
            "a cursor tuple",
            " AND TraceId = {traceId:String} AND StartTime >= fromUnixTimestamp64Milli({cursorStart:Int64})" +
              " AND (toUnixTimestamp64Milli(StartTime), SpanId, TenantId) >" +
              " ({cursorStart:Int64}, {cursorSpan:String}, {cursorTenant:String}) AND ",
          ],
          ["an OR closed inside a group", " AND (SpanId = {a:String} OR SpanId = {b:String}) AND "],
        ])("renders %s AND-ed before it, as the trace repositories write it", (_shape, between) => {
          const rendered = expandStatement({
            query: fenced(between),
            queryParams: { traceId: "tr-1" },
            fence,
          });

          expect(rendered.query).toContain(LATEST_VERSION_SUBQUERY);
        });
      });

      describe("when what follows the election, or its own select, could change what it elects", () => {
        const head =
          "(TenantId, TraceId, SpanId, UpdatedAt) IN (SELECT TenantId, TraceId, SpanId, max(UpdatedAt)" +
          ` FROM stored_spans WHERE ${tenantScopeForLatestVersion("StartTime")}`;
        const KEYS = " GROUP BY TenantId, TraceId, SpanId";
        const fenced = ({ inner = KEYS, after = "" }: { inner?: string; after?: string }) =>
          `SELECT SpanId FROM stored_spans WHERE ${tenantScopeWithConditions("StartTime")}` +
          ` AND ${head}${inner})${after}`;

        /** @scenario "Nothing after the latest-version election can negate or widen it" */
        it.each([
          ["a comparison that negates it", " = 0"],
          ["an OR after it", " OR 1 = 1"],
          ["an OR after an AND-ed term", " AND TraceId = {traceId:String} OR 1 = 1"],
          ["a ternary over the WHERE", " AND 1 = 1 ? 1 : 1"],
          ["a block comment", " /* */ AND 1 = 1"],
        ])("refuses %s", (_shape, after) => {
          expect(refusalOf(fenced({ after }))).toEqual({ kind: "loose-latest-version-marker" });
        });

        /** @scenario "Nothing after the latest-version election can negate or widen it" */
        it.each([
          ["an OR", ` AND TraceId = {traceId:String} OR 1 = 1${KEYS}`],
          [
            "a filter on a column that changes between versions",
            ` AND SpanName = {name:String}${KEYS}`,
          ],
          [
            "a filter hidden in a function's argument",
            ` AND StartTime >= toDateTime(SpanName)${KEYS}`,
          ],
          ["a grouping other than the keys", " GROUP BY TenantId, TraceId"],
          ["a HAVING after the keys", `${KEYS} HAVING max(UpdatedAt) > 0`],
          ["a subquery", ` AND TraceId IN (SELECT TraceId FROM stored_spans)${KEYS}`],
          [
            "an upper bound on the version, electing a stale one",
            ` AND UpdatedAt < {cut:DateTime64(9)}${KEYS}`,
          ],
          ["the same bound written reversed", ` AND {cut:DateTime64(9)} > UpdatedAt${KEYS}`],
          [
            "the same bound inside a function",
            ` AND toUnixTimestamp64Milli(UpdatedAt) < {cutMs:Int64}${KEYS}`,
          ],
          ["an exact version", ` AND UpdatedAt = {at:DateTime64(9)}${KEYS}`],
        ])("refuses an election whose own select carries %s", (_shape, inner) => {
          expect(refusalOf(fenced({ inner }))).toEqual({ kind: "loose-latest-version-marker" });
        });

        /** @scenario "Nothing after the latest-version election can negate or widen it" */
        it("refuses a SETTINGS clause, which could lift the proof's time limit", () => {
          expect(refusalOf(fenced({ after: " SETTINGS max_execution_time = 0" }))).toEqual({
            kind: "settings-under-braids",
          });
        });

        /** @scenario "Nothing after the latest-version election can negate or widen it" */
        it.each([
          ["the end of the WHERE", {}],
          [
            "AND-ed terms, then an order and a cap",
            { after: " AND SpanId = {spanId:String} ORDER BY StartTime LIMIT 10" },
          ],
          ["a grouping", { after: "\n GROUP BY TenantId" }],
          [
            "a line comment, then the order",
            { after: " -- ordered so a cap is stable\n ORDER BY StartTime" },
          ],
          [
            "the trace id, its id bound and a since bound in its own select",
            {
              inner:
                " AND TraceId = {traceId:String} {{idBound:stored_spans.TraceId:traceId}}" +
                ` AND UpdatedAt > fromUnixTimestamp64Milli({sinceMs:Int64})${KEYS}`,
            },
          ],
        ])("renders %s, as the trace repositories write it", (_shape, parts) => {
          expect(
            expandStatement({ query: fenced(parts), queryParams: { traceId: "tr-1" }, fence })
              .query,
          ).toContain(LATEST_VERSION_SUBQUERY);
        });

        it("renders an election closed by its enclosing select's close", () => {
          const query = `SELECT SpanId FROM (${fenced({})}) ARRAY JOIN Events_Name AS name`;

          expect(expandStatement({ query, queryParams: {}, fence }).query).toContain(
            LATEST_VERSION_SUBQUERY,
          );
        });
      });

      it("refuses it on a proof with no braids too", () => {
        expect(
          scopeErrorOf(() =>
            expandStatement({
              query: `SELECT SpanId FROM stored_spans WHERE ${tenantScopeForLatestVersion("StartTime")}`,
              queryParams: {},
              fence: fenceFor({ authorization: proof([own()]), reads: "spans" }),
            }),
          ),
        ).toEqual({ kind: "loose-latest-version-marker" });
      });
    });

    describe("when the cache key is taken", () => {
      /** @scenario "A compiled condition carries the compiler's version" */
      it("changes with a braid's tree and compiler version, and holds for the same proof", () => {
        const key = (grants: GrantInput[]) =>
          tenantScopeKey({ authorization: proof(grants), reads: "spans" });
        const base = key([own(), braid({})]);

        expect(key([own(), braid({})])).toBe(base);
        expect(key([own(), braid({ compiledWhere: CLI })])).not.toBe(base);
        expect(key([own(), braid({ compiledWhere: BRAID_CONDITION_EVERY_SPAN })])).not.toBe(base);
        expect(key([own(), braid({ from: 7 })])).not.toBe(base);
        // A version this reader cannot render is refused before any key is taken.
        expect(
          scopeErrorOf(() => key([own(), braid({ compiledWhere: { ...WEB, version: 2 } })])),
        ).toEqual({ kind: "unsupported-condition-version", version: 2 });
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

    it("binds a predicate its layers share once", () => {
      const fence = fenceFor({
        authorization: proof([
          own(),
          braid({ from: 300, until: 400 }),
          braid({ from: 0, until: 100 }),
        ]),
        reads: "spans",
      });
      const { sql, params } = conditionsExpression({ fence, column: "StartTime" });

      expect(sql.match(/\{tenantScope_p0_k:Array\(String\)\}\[1\]/g)).toHaveLength(2);
      expect(Object.keys(params).filter((name) => /^tenantScope_p\d/.test(name))).toEqual([
        "tenantScope_p0_k",
        "tenantScope_p0_v",
      ]);
    });
  });

  describe("given a proof narrowed for a detail read", () => {
    const authorization = proof([own(), braid({})]);

    it("keeps the braids when narrowed to the reader's own project", () => {
      const narrowed = narrowAuthorization({ authorization, projectId: READER });

      expect(fenceFor({ authorization: narrowed, reads: "spans" }).braids?.clauses).toHaveLength(1);
    });
  });

  describe("given a braid compiled by a compiler this reader does not know", () => {
    it("refuses the fence by name rather than read the owner's spans unconditioned", () => {
      const future = proof([own(), braid({ compiledWhere: { ...WEB, version: 99 } })]);

      expect(scopeErrorOf(() => fenceFor({ authorization: future, reads: "spans" }))).toEqual({
        kind: "unsupported-condition-version",
        version: 99,
      });
    });
  });

  describe("given a braid whose condition is every span", () => {
    const authorization = proof([own(), braid({ compiledWhere: BRAID_CONDITION_EVERY_SPAN })]);

    /** @scenario "A braid with no condition is fenced to the reader's held traces like any other" */
    it("renders it under the held-trace semi-join with an always-true predicate", () => {
      const { sql, params } = conditionsExpression({
        fence: fenceFor({ authorization, reads: "spans" }),
        column: "StartTime",
      });

      expect(sql).toContain(`OR (${held()} AND ((TenantId IN ({tenantScope_c0_ids`);
      expect(sql).toContain(" AND (1))))");
      expect(sql).not.toMatch(/SpanAttributes|SpanName =/);
      expect(params).toMatchObject({ tenantScope_c0_ids: [OWNER], tenantScope_heldFrom: 0 });
    });

    /** @scenario "A braid with no condition is fenced to the reader's held traces like any other" */
    it("keys it apart from a braid with a condition and from a trace window", () => {
      const key = tenantScopeKey({ authorization, reads: "spans" });

      expect(key).not.toBe(
        tenantScopeKey({ authorization: proof([own(), braid({})]), reads: "spans" }),
      );
      expect(fenceFor({ authorization, reads: "spans" }).braids?.clauses).toEqual([
        expect.objectContaining({ kind: "braid", compiledWhere: BRAID_CONDITION_EVERY_SPAN }),
      ]);
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

    it("binds fewer parameters than ClickHouse accepts as fields in one request", () => {
      const { queryParams } = expandSpanRead(proof([own(), ...grants]));
      const count = Object.keys(queryParams).length;

      expect(STATEMENT_PARAM_BUDGET).toBeLessThan(CLICKHOUSE_HTTP_MAX_FIELDS);
      expect(count).toBeLessThanOrEqual(STATEMENT_PARAM_BUDGET);
      // Five per condition (three window arrays, keys, values), never one per term.
      expect(count).toBeLessThanOrEqual(5 * BRAID_MAX_DISTINCT_CONDITIONS + 10);
    });
  });

  describe("given an expanded statement binding more parameters than its budget", () => {
    it("refuses it by name before anything is sent", () => {
      const queryParams = Object.fromEntries(
        Array.from({ length: STATEMENT_PARAM_BUDGET }, (_, index) => [`p${index}`, index]),
      );

      expect(
        scopeErrorOf(() =>
          expandStatement({
            query: `SELECT 1 FROM stored_spans WHERE ${tenantScope("StartTime")}`,
            queryParams,
            fence: fenceFor({ authorization: proof([own()]), reads: "spans" }),
          }),
        ),
      ).toMatchObject({ kind: "over-param-budget", budget: STATEMENT_PARAM_BUDGET });
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

  describe("given a held reader whose proof expires between statements", () => {
    const readerAt = ({
      clock,
      authorization,
      reads,
      execute: sent,
    }: {
      clock: { now: number };
      authorization: Authorization;
      reads: "spans" | "traces";
      execute?: ReturnType<typeof vi.fn<QueryDriver["execute"]>>;
    }) => {
      const execute = sent ?? vi.fn<QueryDriver["execute"]>().mockResolvedValue({ rows: [] });
      const client = new ClickHouseQueryClient({
        tenantGuard: new TenantGuard(),
        driver: { execute, insert: async () => {}, command: async () => {} },
      });
      return new AuthorizedClickHouse({
        resolveClient: vi.fn().mockResolvedValue(client),
        now: () => clock.now,
      }).as(authorization, { reads });
    };

    it("cuts a braid's read at expiry, so a removed braid outlives no proof", async () => {
      const clock = { now: NOW };
      const reader = readerAt({ clock, authorization: proof([own(), braid({})]), reads: "spans" });
      clock.now = NOW + 30_000;

      await expect(
        reader.query({
          query: spanRead(tenantScopeWithConditions("StartTime")),
          query_params: { traceId: "tr-1" },
        }),
      ).rejects.toBeInstanceOf(AuthorizationExpiredError);
    });

    describe("when the proof expires while a braid's statement is running", () => {
      /** @scenario "A braided read whose proof expires while its statement runs returns no row" */
      it("refuses the rows as expired rather than release them", async () => {
        const clock = { now: NOW };
        const authorization = proof([own(), braid({})]);
        const execute = vi.fn<QueryDriver["execute"]>(async () => {
          clock.now = authorization.expiresAt;
          return { rows: [{ SpanId: "owner-span" }] };
        });
        const reader = readerAt({ clock, authorization, reads: "spans", execute });

        await expect(
          reader.query({
            query: spanRead(tenantScopeWithConditions("StartTime")),
            query_params: { traceId: "tr-1" },
          }),
        ).rejects.toBeInstanceOf(AuthorizationExpiredError);
      });

      /** @scenario "A braided read whose proof expires while its statement runs returns no row" */
      it("sends it with a time limit no longer than the proof's remaining life", async () => {
        const clock = { now: NOW };
        const authorization = proof([own(), braid({})]);
        const execute = vi.fn<QueryDriver["execute"]>().mockResolvedValue({ rows: [] });
        const reader = readerAt({ clock, authorization, reads: "spans", execute });

        await reader.query({
          query: spanRead(tenantScopeWithConditions("StartTime")),
          query_params: { traceId: "tr-1" },
          clickhouse_settings: { max_execution_time: 600 },
        });

        expect(execute.mock.calls[0]?.[0].settings?.max_execution_time).toBe(
          Math.ceil((authorization.expiresAt - NOW) / 1000),
        );
      });
    });

    it("keeps a reader with no braids, so a long export is not cut midway", async () => {
      const clock = { now: NOW };
      const reader = readerAt({ clock, authorization: proof([own()]), reads: "traces" });
      clock.now = NOW + 30_000;

      await expect(
        reader.query({ query: `SELECT 1 FROM t WHERE ${tenantScope("StartTime")}` }),
      ).resolves.toBeDefined();
    });
  });
});
