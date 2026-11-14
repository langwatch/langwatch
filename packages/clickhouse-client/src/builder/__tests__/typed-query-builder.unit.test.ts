/**
 * ADR-202, "The typed builder": scopes, descriptors, the fence's operations, and parity with the
 * fence's own expansion of the equivalent marker statement.
 * @see specs/clickhouse/typed-query-builder.feature
 */
import {
  type AuthorizationInput,
  type CompiledWhere,
  honourSpanBraids,
  sealAuthorization,
  SPAN_BRAID_PERMISSION,
} from "@langwatch/authorization";
import {
  tenantScope as tenantScopeMarker,
  tenantScopeForLatestVersion,
  tenantScopeWithConditions,
} from "@langwatch/clickhouse-markers";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  conditionsExpression,
  expandStatement,
  fenceExpression,
  HAND_WRITTEN_TENANT_PREDICATE,
  type ReadResource,
} from "../../authorized-reads.ts";
import { TENANT_IDS_SETTING } from "../../identity/tenantSetting.ts";
import { checkTenantScope } from "../../tenantGuard.ts";
import { column, sql } from "../expression.ts";
import { fn } from "../functions.ts";
import { clickhouseRead, type ReaderReadStatement, readerStatementOf } from "../read.ts";
import { REVIEWED_FRAGMENTS } from "../reviewed-fragments.ts";
import { tenantScope } from "../scope.ts";
import { defineClickHouseTable } from "../table.ts";

const NOW = 1_800_000_000_000;
const READER = "proj_reader";
const OWNER = "proj_owner";
const MEMBER = "proj_member";
const PINS = { prefer_column_name_to_alias: 1, enable_global_with_statement: 1 };

const storedSpans = defineClickHouseTable({
  name: "stored_spans",
  tenantColumn: "TenantId",
  timeColumn: "StartTime",
  versionColumn: "UpdatedAt",
  sortKey: ["TenantId", "TraceId", "SpanId"],
  columns: {
    TenantId: column.string(),
    TraceId: column.string(),
    SpanId: column.string(),
    SpanName: column.string(),
    StartTime: column.dateTime64({ precision: 9 }),
    UpdatedAt: column.dateTime64({ precision: 3 }),
    SpanAttributes: column.stringMap(),
  },
});

const traceSummaries = defineClickHouseTable({
  name: "trace_summaries",
  tenantColumn: "TenantId",
  timeColumn: "OccurredAt",
  sortKey: ["TenantId", "TraceId"],
  columns: {
    TenantId: column.string(),
    TraceId: column.string(),
    OccurredAt: column.dateTime64({ precision: 3 }),
    TotalCost: column.float64(),
  },
});

const storedObjects = defineClickHouseTable({
  name: "stored_objects",
  tenantColumn: "project_id",
  sortKey: ["id"],
  columns: { project_id: column.string(), id: column.string() },
});

type GrantInput = AuthorizationInput["grants"][number];

const own = (): GrantInput => ({
  projectId: READER,
  permissions: ["traces:view", "analytics:view"],
  via: [],
  kind: "own",
});

const memberWindow: GrantInput = {
  projectId: MEMBER,
  permissions: ["traces:view"],
  via: ["grant_member"],
  kind: "shared",
  condition: { type: "trace", from: NOW - 1000, until: null },
};

const WEB: CompiledWhere = {
  version: 1,
  tree: { kind: "attributeEquals", on: "span", key: "orchestrator", value: "web" },
};

const braid: GrantInput = {
  projectId: OWNER,
  permissions: [SPAN_BRAID_PERMISSION],
  via: ["grant_owner"],
  kind: "shared",
  condition: { type: "span", where: "compiled", compiledWhere: WEB, from: 0, until: null },
};

const proofScope = ({ grants, reads = "traces" }: { grants: GrantInput[]; reads?: ReadResource }) =>
  tenantScope.fromProof({
    authorization: honourSpanBraids({
      authorization: sealAuthorization({
        actor: { type: "user", id: "ana" },
        principal: { type: "user", id: "ana" },
        scope: { organizationId: "org_acme" },
        grants,
        expiresAt: NOW + 30_000,
        purpose: { kind: "route", route: "traces.get" },
      }),
    }),
    reads,
    now: () => NOW,
  });

const single = tenantScope.single({ tenantId: "proj_a" });

/** The refusal a build throws, by code and violation kind, never by message. */
function refusalOf(build: () => unknown): { code: unknown; kind: unknown } {
  try {
    build();
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null && "code" in error && "violation" in error) {
      const { violation } = error;
      const kind =
        typeof violation === "object" && violation !== null && "kind" in violation
          ? violation.kind
          : undefined;
      return { code: error.code, kind };
    }
    throw error;
  }
  throw new Error("expected a refusal; the build succeeded");
}

describe("the typed read builder", () => {
  describe("when the scope is missing", () => {
    /** @scenario "A read without a tenant scope does not type-check" */
    it("refuses the call at compile time and at run time", () => {
      // @ts-expect-error the scope is a required argument
      expect(refusalOf(() => clickhouseRead({}))).toEqual({
        code: "store_query_builder",
        kind: "missing-scope",
      });
    });
  });

  describe("when the scope is one tenant", () => {
    /** @scenario "A single-tenant read binds its tenant as a parameter and as the tenant setting" */
    it("binds the tenant and names it alone in the setting", () => {
      const built = clickhouseRead({ scope: single })
        .from(storedSpans)
        .select({ SpanId: storedSpans.SpanId })
        .where(({ eq }) => eq(storedSpans.TraceId, "trace_1"))
        .build();

      expectTypeOf(built.identity).toEqualTypeOf<"reader">();
      expect(built.sql).toBe(
        "SELECT SpanId FROM stored_spans WHERE TenantId = {tenantId:String} AND TraceId = {v0:String}",
      );
      expect(built.params).toEqual({ tenantId: "proj_a", v0: "trace_1" });
      expect(built.settings).toEqual({ ...PINS, [TENANT_IDS_SETTING]: "proj_a" });
      expect(built.identity).toBe("reader");

      const objects = clickhouseRead({ scope: single })
        .from(storedObjects)
        .select({ id: storedObjects.id })
        .build();
      expect(objects.sql).toBe(
        "SELECT id FROM stored_objects WHERE project_id = {tenantId:String}",
      );
    });
  });

  describe("when the client's tenant guard checks a built statement", () => {
    it("accepts a single-tenant read by its own predicate and a set read by its set", () => {
      const singleRead = clickhouseRead({ scope: single })
        .from(traceSummaries)
        .select({ TraceId: traceSummaries.TraceId })
        .build();
      const setRead = clickhouseRead({
        scope: tenantScope.set({ tenantIds: ["proj_a", "proj_b"] }),
      })
        .from(traceSummaries)
        .select({ TraceId: traceSummaries.TraceId })
        .build();

      expect(singleRead.tenantIds).toBeUndefined();
      for (const built of [singleRead, setRead]) {
        expect(
          checkTenantScope({
            sql: built.sql,
            params: built.params,
            tenantId: built.tenantId,
            tenantIds: built.tenantIds,
          }),
        ).toBeNull();
      }
    });
  });

  describe("when the scope is a tenant set", () => {
    /** @scenario "A tenant-set read binds the set and names every member in the tenant setting" */
    it("binds the set as one array and lists it comma-separated", () => {
      const built = clickhouseRead({ scope: tenantScope.set({ tenantIds: ["proj_a", "proj_b"] }) })
        .from(traceSummaries)
        .select({ TraceId: traceSummaries.TraceId })
        .build();

      expect(built.sql).toBe(
        "SELECT TraceId FROM trace_summaries WHERE TenantId IN ({tenantIds:Array(String)})",
      );
      expect(built.params).toEqual({ tenantIds: ["proj_a", "proj_b"] });
      expect(built.settings[TENANT_IDS_SETTING]).toBe("proj_a,proj_b");
    });

    /** @scenario "A tenant set that could widen the tenant setting is refused" */
    it("refuses an empty set, an empty id and an id carrying a comma", () => {
      expect(refusalOf(() => tenantScope.set({ tenantIds: [] })).kind).toBe("empty-tenant-set");
      expect(refusalOf(() => tenantScope.single({ tenantId: " " })).kind).toBe(
        "malformed-tenant-id",
      );
      expect(
        refusalOf(() => tenantScope.set({ tenantIds: ["proj_a", "proj_b,proj_c"] })).kind,
      ).toBe("malformed-tenant-id");
    });
  });

  describe("when the scope comes from a proof", () => {
    /** @scenario "A proof-scoped read takes the fence's tenants for the predicate and the setting alike" */
    it("renders the fence and lists exactly its tenants in the setting", () => {
      const scope = proofScope({ grants: [own(), memberWindow] });
      const built = clickhouseRead({ scope })
        .from(storedSpans)
        .withinWindows()
        .select({ SpanId: storedSpans.SpanId })
        .build();
      const fence = fenceExpression({ fence: scope.fence, column: "StartTime" });

      expect(built.sql).toBe(`SELECT SpanId FROM stored_spans WHERE ${fence.sql}`);
      expect(built.params).toEqual(fence.params);
      expect(built.settings[TENANT_IDS_SETTING]).toBe(`${READER},${MEMBER}`);
      expect(built.params.tenantScope_all).toEqual(built.tenantIds);
      expect(built.routeTenantId).toBe(READER);
    });

    /** @scenario "A proof-scoped read that names no window treatment is refused" */
    it("refuses a read that neither stays within windows nor reads braided", () => {
      const read = clickhouseRead({ scope: proofScope({ grants: [own(), memberWindow] }) })
        .from(storedSpans)
        .select({ SpanId: storedSpans.SpanId });

      expect(refusalOf(() => read.build())).toEqual({
        code: "store_statement_scope",
        kind: "missing-marker",
      });
      expect(
        refusalOf(() => clickhouseRead({ scope: single }).from(storedSpans).withinWindows()).kind,
      ).toBe("windows-need-a-proof");
    });

    /** @scenario "A braided read applies each braid's condition under the held-trace semi-join" */
    it("renders the conditions the fence renders and refuses plain windows", () => {
      const scope = proofScope({ grants: [own(), braid], reads: "spans" });
      const read = clickhouseRead({ scope })
        .from(storedSpans)
        .select({ SpanId: storedSpans.SpanId });
      const built = read.braided({ heldTrace: { traceId: "trace_1" } }).build();
      const conditions = conditionsExpression({
        fence: scope.fence,
        column: "StartTime",
        held: { kind: "traceId", param: "v0" },
      });

      expect(built.sql).toBe(`SELECT SpanId FROM stored_spans WHERE ${conditions.sql}`);
      expect(built.params).toEqual({ ...conditions.params, v0: "trace_1" });
      expect(built.expiresAt).toBe(NOW + 30_000);
      expect(refusalOf(() => read.withinWindows())).toEqual({
        code: "store_statement_scope",
        kind: "plain-marker-under-braids",
      });
    });
  });

  describe("when the scope is every tenant", () => {
    /** @scenario "An all-tenants read goes out on the system identity and carries no tenant setting" */
    it("names the system identity and renders no tenant predicate", () => {
      const built = clickhouseRead({ scope: tenantScope.allTenants({ reason: "retention sweep" }) })
        .from(storedSpans)
        .select({ SpanId: storedSpans.SpanId })
        .where(({ lt }) => lt(storedSpans.StartTime, 1000))
        .build();

      expectTypeOf(built.identity).toEqualTypeOf<"system">();
      expect(built.identity).toBe("system");
      expect(built.sql).toBe(
        "SELECT SpanId FROM stored_spans WHERE StartTime < fromUnixTimestamp64Milli({v0:Int64})",
      );
      expect(built.settings).toEqual(PINS);
      expect(built.reason).toBe("retention sweep");
      expect(refusalOf(() => tenantScope.allTenants({ reason: "" })).kind).toBe("missing-reason");
    });

    /** @scenario "An all-tenants read is refused on the reader identity" */
    it("does not type-check as a reader statement and is refused at run time", () => {
      const built = clickhouseRead({ scope: tenantScope.allTenants({ reason: "usage meter" }) })
        .from(traceSummaries)
        .select({ TraceId: traceSummaries.TraceId })
        .build();
      const sendAsReader = (statement: ReaderReadStatement) => statement.identity;

      // @ts-expect-error an all-tenants statement is not a reader statement
      expect(sendAsReader(built)).toBe("system");
      expect(refusalOf(() => readerStatementOf({ statement: built }))).toEqual({
        code: "store_query_builder",
        kind: "all-tenants-on-reader",
      });
    });
  });

  describe("when a read names columns", () => {
    /** @scenario "A column the table does not declare does not type-check" */
    it("refuses an undeclared column and a column of a table outside the read", () => {
      expectTypeOf(storedSpans).not.toHaveProperty("Nope");
      expectTypeOf(storedSpans).toHaveProperty("TraceId");
      const read = clickhouseRead({ scope: single }).from(storedSpans);

      // @ts-expect-error trace_summaries is not read here
      const foreign = read.select({ cost: traceSummaries.TotalCost });
      expect(refusalOf(() => foreign.build())).toEqual({
        code: "store_query_builder",
        kind: "foreign-column",
      });
    });

    /** @scenario "Every value is a named parameter and the only text escape is a reviewed fragment" */
    it("binds every value and renders only reviewed fragment text", () => {
      const hostile = "x') OR 1 = 1 --";
      const built = clickhouseRead({ scope: single })
        .from(storedSpans)
        .select({
          SpanId: storedSpans.SpanId,
          model: sql.fragment("spans.responseModel"),
          env: fn.mapGet(storedSpans.SpanAttributes, "env"),
        })
        .where(({ and, oneOf, range }) =>
          and(
            oneOf(storedSpans.SpanName, [hostile, "b"]),
            range(storedSpans.StartTime, { from: 1000, until: 2000 }),
          ),
        )
        .build();

      expect(built.sql).toBe(
        `SELECT SpanId, ${REVIEWED_FRAGMENTS["spans.responseModel"].sql} AS model,` +
          " SpanAttributes[{v0:String}] AS env FROM stored_spans WHERE TenantId = {tenantId:String}" +
          " AND (SpanName IN ({v1:Array(String)}) AND (StartTime >= fromUnixTimestamp64Milli({v2:Int64})" +
          " AND StartTime < fromUnixTimestamp64Milli({v3:Int64})))",
      );
      expect(built.params).toEqual({
        tenantId: "proj_a",
        v0: "env",
        v1: [hostile, "b"],
        v2: 1000,
        v3: 2000,
      });
      for (const fragment of Object.values(REVIEWED_FRAGMENTS)) {
        expect(HAND_WRITTEN_TENANT_PREDICATE.test(fragment.sql)).toBe(false);
        expect(fragment.sql).not.toMatch(/TenantId|project_id|SQL_langwatch_|SETTINGS|\{/i);
      }
    });

    /** @scenario "An alias named after a column the read declares is refused" */
    it("refuses a selection key that shadows another declared column", () => {
      const read = clickhouseRead({ scope: single })
        .from(storedSpans)
        .select({ TraceId: storedSpans.SpanName });

      expect(refusalOf(() => read.build())).toEqual({
        code: "store_statement_scope",
        kind: "shadowing-alias",
      });
    });
  });

  describe("when a read asks for the fence's other operations", () => {
    /** @scenario "The latest version is elected inside the same fence" */
    it("elects keys and version under the scope, repeating only key and time filters", () => {
      const built = clickhouseRead({ scope: single })
        .from(storedSpans)
        .select({ SpanId: storedSpans.SpanId })
        .where(({ eq }) => eq(storedSpans.TraceId, "trace_1"))
        .where(({ eq }) => eq(storedSpans.SpanName, "llm"))
        .latestVersion()
        .build();

      expect(built.sql).toBe(
        "SELECT SpanId FROM stored_spans WHERE TenantId = {tenantId:String} AND TraceId = {v0:String}" +
          " AND SpanName = {v1:String} AND (TenantId, TraceId, SpanId, UpdatedAt) IN" +
          " (SELECT TenantId, TraceId, SpanId, max(UpdatedAt) FROM stored_spans" +
          " WHERE TenantId = {tenantId:String} AND TraceId = {v0:String} GROUP BY TenantId, TraceId, SpanId)",
      );
      expect(
        refusalOf(() => clickhouseRead({ scope: single }).from(traceSummaries).latestVersion())
          .kind,
      ).toBe("no-version-column");
    });

    /** @scenario "The latest-version election keeps the read's time window" */
    it("repeats a filter on the time column inside the election, for partition pruning", () => {
      const built = clickhouseRead({ scope: single })
        .from(storedSpans)
        .select({ SpanId: storedSpans.SpanId })
        .where(({ gte }) => gte(storedSpans.StartTime, 1000))
        .latestVersion()
        .build();

      expect(built.sql).toBe(
        "SELECT SpanId FROM stored_spans WHERE TenantId = {tenantId:String} AND StartTime >= fromUnixTimestamp64Milli({v0:Int64})" +
          " AND (TenantId, TraceId, SpanId, UpdatedAt) IN" +
          " (SELECT TenantId, TraceId, SpanId, max(UpdatedAt) FROM stored_spans" +
          " WHERE TenantId = {tenantId:String} AND StartTime >= fromUnixTimestamp64Milli({v0:Int64}) GROUP BY TenantId, TraceId, SpanId)",
      );
    });

    /** @scenario "FINAL is refused on a table whose sort key does not hold its tenant column" */
    it("reads with FINAL only where the sort key holds the tenant column", () => {
      const built = clickhouseRead({ scope: single })
        .from(traceSummaries)
        .final()
        .select({ TraceId: traceSummaries.TraceId })
        .build();

      expect(built.sql).toBe(
        "SELECT TraceId FROM trace_summaries FINAL WHERE TenantId = {tenantId:String}",
      );
      expect(
        refusalOf(() => clickhouseRead({ scope: single }).from(storedObjects).final()).kind,
      ).toBe("final-without-tenant-key");
    });

    /** @scenario "A join scopes both sides and equates their tenants" */
    it("reads each side under its own predicate and joins on the tenant", () => {
      const built = clickhouseRead({ scope: single })
        .from(traceSummaries)
        .innerJoin(storedSpans, ({ eq }) => eq(storedSpans.TraceId, traceSummaries.TraceId))
        .select({ traceId: traceSummaries.TraceId, name: storedSpans.SpanName })
        .where(({ gt }) => gt(traceSummaries.TotalCost, 0))
        .build();

      expect(built.sql).toBe(
        "SELECT trace_summaries.TraceId AS traceId, stored_spans.SpanName AS name" +
          " FROM (SELECT TenantId, TraceId, TotalCost FROM trace_summaries WHERE TenantId = {tenantId:String}) AS trace_summaries" +
          " INNER JOIN (SELECT TenantId, TraceId, SpanName FROM stored_spans WHERE TenantId = {tenantId:String}) AS stored_spans" +
          " ON trace_summaries.TenantId = stored_spans.TenantId AND stored_spans.TraceId = trace_summaries.TraceId" +
          " WHERE trace_summaries.TotalCost > {v0:Float64}",
      );
      expect(built.params).toEqual({ tenantId: "proj_a", v0: 0 });
    });

    /** @scenario "A common table expression and a UNION ALL arm inherit the read's scope" */
    it("scopes every select and renders the arm in the read's column order", () => {
      const built = clickhouseRead({ scope: single })
        .from(traceSummaries)
        .with("costly", (sub) =>
          sub
            .from(traceSummaries)
            .select({ TraceId: traceSummaries.TraceId })
            .where(({ gt }) => gt(traceSummaries.TotalCost, 1)),
        )
        .select({ traceId: traceSummaries.TraceId, at: traceSummaries.OccurredAt })
        .where(({ oneOf }) => oneOf(traceSummaries.TraceId, { cte: "costly" }))
        .unionAll((arm) =>
          arm.from(storedSpans).select({ at: storedSpans.StartTime, traceId: storedSpans.TraceId }),
        )
        .build();

      expect(built.sql).toBe(
        "WITH costly AS (SELECT TraceId FROM trace_summaries WHERE TenantId = {tenantId:String}" +
          " AND TotalCost > {v0:Float64}) SELECT TraceId AS traceId, OccurredAt AS at FROM trace_summaries" +
          " WHERE TenantId = {tenantId:String} AND TraceId IN costly UNION ALL SELECT TraceId AS traceId," +
          " StartTime AS at FROM stored_spans WHERE TenantId = {tenantId:String}",
      );
    });
  });

  describe("when the builder and the fence render an equivalent read", () => {
    /** @scenario "The builder renders what the fence renders for an equivalent fenced read" */
    it("renders equal text and parameters for three fenced shapes", () => {
      const windowedScope = proofScope({ grants: [own(), memberWindow] });
      const windowed = clickhouseRead({ scope: windowedScope })
        .from(storedSpans)
        .withinWindows()
        .select({ SpanId: storedSpans.SpanId, SpanName: storedSpans.SpanName })
        .where(({ eq }) => eq(storedSpans.TraceId, "trace_1"))
        .orderBy(storedSpans.StartTime, "ASC")
        .limit(100)
        .build();
      const windowedFenced = expandStatement({
        query:
          `SELECT SpanId, SpanName FROM stored_spans WHERE ${tenantScopeMarker("StartTime")}` +
          " AND TraceId = {v0:String} ORDER BY StartTime ASC LIMIT 100",
        queryParams: { v0: "trace_1" },
        fence: windowedScope.fence,
      });
      expect({ sql: windowed.sql, params: windowed.params }).toEqual({
        sql: windowedFenced.query,
        params: windowedFenced.queryParams,
      });

      const braidedScope = proofScope({ grants: [own(), braid], reads: "spans" });
      const braided = clickhouseRead({ scope: braidedScope })
        .from(storedSpans)
        .braided({ heldTrace: { traceId: "trace_1" } })
        .select({ SpanId: storedSpans.SpanId, SpanName: storedSpans.SpanName })
        .where(({ eq }) => eq(storedSpans.TraceId, "trace_1"))
        .latestVersion()
        .build();
      const braidedFenced = expandStatement({
        query:
          "SELECT SpanId, SpanName FROM stored_spans" +
          ` WHERE ${tenantScopeWithConditions("StartTime", { traceId: "v0" })} AND TraceId = {v1:String}` +
          " AND (TenantId, TraceId, SpanId, UpdatedAt) IN (SELECT TenantId, TraceId, SpanId, max(UpdatedAt)" +
          ` FROM stored_spans WHERE ${tenantScopeForLatestVersion("StartTime")} AND TraceId = {v1:String}` +
          " GROUP BY TenantId, TraceId, SpanId)",
        queryParams: { v0: "trace_1", v1: "trace_1" },
        fence: braidedScope.fence,
      });
      expect({ sql: braided.sql, params: braided.params }).toEqual({
        sql: braidedFenced.query,
        params: braidedFenced.queryParams,
      });

      const cte = clickhouseRead({ scope: windowedScope })
        .from(traceSummaries)
        .withinWindows()
        .with("recent", (sub) =>
          sub
            .from(storedSpans)
            .withinWindows()
            .select({ TraceId: storedSpans.TraceId })
            .where(({ eq }) => eq(storedSpans.SpanName, "llm")),
        )
        .select({ TraceId: traceSummaries.TraceId })
        .where(({ oneOf }) => oneOf(traceSummaries.TraceId, { cte: "recent" }))
        .build();
      const cteFenced = expandStatement({
        query:
          `WITH recent AS (SELECT TraceId FROM stored_spans WHERE ${tenantScopeMarker("StartTime")}` +
          " AND SpanName = {v0:String}) SELECT TraceId FROM trace_summaries" +
          ` WHERE ${tenantScopeMarker("OccurredAt")} AND TraceId IN recent`,
        queryParams: { v0: "llm" },
        fence: windowedScope.fence,
      });
      expect({ sql: cte.sql, params: cte.params }).toEqual({
        sql: cteFenced.query,
        params: cteFenced.queryParams,
      });
    });
  });
});
