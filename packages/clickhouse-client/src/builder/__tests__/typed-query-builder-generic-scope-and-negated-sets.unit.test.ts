/**
 * ADR-202, "The typed builder": a scope-generic caller's start takes a tenant table uncast, and a
 * negated set subquery writes `NOT IN`, leaving the inner tenant predicate unnegated, as
 * trace's filter compiler and analytics' negated filters need.
 * @see specs/clickhouse/typed-query-builder.feature
 */
import { type AuthorizationInput, sealAuthorization } from "@langwatch/authorization";
import { describe, expect, it } from "vitest";

import { fenceExpression } from "../../authorized-reads.ts";
import { TENANT_IDS_SETTING } from "../../identity/tenantSetting.ts";
import { StatementScopeError } from "../../statementScopeError.ts";
import { checkTenantScope } from "../../tenantGuard.ts";
import { column } from "../expression.ts";
import { fn } from "../functions.ts";
import { QueryBuilderError } from "../query-builder-error.ts";
import { type ClickHouseReadStart, clickhouseRead } from "../read.ts";
import { type ReaderScope, type TenantScope, tenantScope } from "../scope.ts";
import { defineClickHouseTable } from "../table.ts";

const NOW = 1_800_000_000_000;
const READER = "proj_reader";
const MEMBER = "proj_member";

const summaries = defineClickHouseTable({
  name: "trace_summaries",
  tenantColumn: "TenantId",
  timeColumn: "OccurredAt",
  sortKey: ["TenantId", "TraceId"],
  columns: {
    TenantId: column.string(),
    TraceId: column.string(),
    OccurredAt: column.dateTime64({ precision: 3 }),
  },
});

const spans = defineClickHouseTable({
  name: "stored_spans",
  tenantColumn: "TenantId",
  timeColumn: "StartTime",
  sortKey: ["TenantId", "TraceId", "SpanId"],
  columns: {
    TenantId: column.string(),
    TraceId: column.string(),
    SpanId: column.string(),
    SpanName: column.string(),
    StartTime: column.dateTime64({ precision: 9 }),
  },
});

type GrantInput = AuthorizationInput["grants"][number];

const proof = () =>
  tenantScope.fromProof({
    authorization: sealAuthorization({
      actor: { type: "user", id: "ana" },
      principal: { type: "user", id: "ana" },
      scope: { organizationId: "org_acme" },
      grants: [
        { projectId: READER, permissions: ["traces:view"], via: [], kind: "own" },
        {
          projectId: MEMBER,
          permissions: ["traces:view"],
          via: ["grant_member"],
          kind: "shared",
          condition: { type: "trace", from: NOW - 1000, until: null },
        } satisfies GrantInput,
      ],
      expiresAt: NOW + 30_000,
      purpose: { kind: "route", route: "traces.get" },
    }),
    reads: "traces",
    now: () => NOW,
  });

const single = tenantScope.single({ tenantId: "proj_a" });

/** The refusal a build throws, by violation kind, never by message. */
function refusalOf(build: () => unknown): unknown {
  try {
    build();
  } catch (error) {
    if (error instanceof QueryBuilderError || error instanceof StatementScopeError) {
      return error.violation.kind;
    }
    throw error;
  }
  return undefined;
}

/** A scope-generic caller, as trace's filter compiler is: no cast between start and table. */
function tracesWithoutLlm<S extends ReaderScope>({
  scope,
  windowed,
  innerWindowed = windowed,
}: {
  scope: S;
  windowed: boolean;
  innerWindowed?: boolean;
}) {
  const inner = (sub: ClickHouseReadStart<S>) => {
    const read = sub
      .from(spans)
      .select({ TenantId: spans.TenantId, TraceId: spans.TraceId })
      .where(({ eq }) => eq(spans.SpanName, "llm"));
    return innerWindowed ? read.withinWindows() : read;
  };
  const outer = clickhouseRead({ scope }).from(summaries);
  return (windowed ? outer.withinWindows() : outer)
    .select({ TraceId: summaries.TraceId })
    .where(({ within }) =>
      within(fn.tuple(summaries.TenantId, summaries.TraceId), inner, { negated: true }),
    );
}

describe("given a read whose scope is a type parameter", () => {
  describe("when the parameter is a reader's scope", () => {
    /** @scenario "A scope-generic caller reads a tenant table without a cast" */
    it("takes a tenant table at the start and in a set subquery", () => {
      const sql = tracesWithoutLlm({ scope: single, windowed: false }).build().sql;

      expect(sql).toContain("FROM trace_summaries WHERE TenantId = {tenantId:String}");
    });

    /** @scenario "A scope-generic caller reads a tenant table without a cast" */
    it("still refuses a tenant table to a start that may be server metadata", () => {
      const anyScope = <S extends TenantScope>(start: ClickHouseReadStart<S>) =>
        // @ts-expect-error a scope that may be server metadata reads no tenant table
        start.from(summaries);

      expect(
        refusalOf(() =>
          anyScope(clickhouseRead({ scope: tenantScope.serverMetadata({ reason: "test" }) })),
        ),
      ).toBe("table-outside-scope");
    });
  });
});

describe("given a negated set subquery", () => {
  describe("when the read is single-tenant", () => {
    /** @scenario "A negated set subquery writes NOT IN and keeps the inner predicate" */
    it("renders NOT IN, the inner read carrying its own unnegated tenant predicate", () => {
      const built = tracesWithoutLlm({ scope: single, windowed: false }).build();

      expect(built.sql).toBe(
        "SELECT TraceId FROM trace_summaries WHERE TenantId = {tenantId:String} AND " +
          "tuple(TenantId, TraceId) NOT IN (SELECT TenantId, TraceId FROM stored_spans " +
          "WHERE TenantId = {tenantId:String} AND SpanName = {v0:String})",
      );
      expect(built.settings[TENANT_IDS_SETTING]).toBe("proj_a");
    });

    /** @scenario "A negated set subquery writes NOT IN and keeps the inner predicate" */
    it("passes the tenant guard, which refuses the same subquery under NOT (…)", () => {
      const statement = (negate: "option" | "not") =>
        clickhouseRead({ scope: single })
          .from(summaries)
          .select({ TraceId: summaries.TraceId })
          .where(({ within, not }) => {
            const left = fn.tuple(summaries.TenantId, summaries.TraceId);
            const sub = (start: ClickHouseReadStart<typeof single>) =>
              start.from(spans).select({ TenantId: spans.TenantId, TraceId: spans.TraceId });
            return negate === "option"
              ? within(left, sub, { negated: true })
              : not(within(left, sub));
          })
          .build();
      const guard = (built: ReturnType<typeof statement>) =>
        checkTenantScope({ sql: built.sql, params: built.params, tenantId: "proj_a" });

      expect(guard(statement("option"))).toBeNull();
      expect(guard(statement("not"))).toEqual({ kind: "negated-predicate" });
    });

    /** @scenario "A negated set subquery writes NOT IN and keeps the inner predicate" */
    it("refuses what within refuses: another scope, no tenant table, the wrong width", () => {
      const read = clickhouseRead({ scope: single }).from(summaries);

      expect(
        refusalOf(() =>
          read.where(({ within }) =>
            within(
              summaries.TraceId,
              () =>
                clickhouseRead({ scope: tenantScope.single({ tenantId: "proj_b" }) })
                  .from(spans)
                  .select({ TraceId: spans.TraceId }),
              { negated: true },
            ),
          ),
        ),
      ).toBe("foreign-scope");
      expect(
        refusalOf(() =>
          read.where(({ within }) =>
            within(
              summaries.TraceId,
              (sub) => sub.from(spans).select({ TenantId: spans.TenantId, TraceId: spans.TraceId }),
              { negated: true },
            ),
          ),
        ),
      ).toBe("set-arity");
    });
  });

  describe("when the read is proof-scoped", () => {
    /** @scenario "A negated set subquery writes NOT IN and keeps the inner predicate" */
    it("holds the share's windows on the inner table's own time column", () => {
      const scope = proof();
      const built = tracesWithoutLlm({ scope, windowed: true }).build();
      const inner = fenceExpression({ fence: scope.fence, column: "StartTime" }).sql;

      expect(built.sql).toContain(
        `NOT IN (SELECT TenantId, TraceId FROM stored_spans WHERE ${inner}`,
      );
      expect(built.settings[TENANT_IDS_SETTING]).toBe(`${READER},${MEMBER}`);
    });

    /** @scenario "A negated set subquery writes NOT IN and keeps the inner predicate" */
    it("refuses an inner read that names no window treatment", () => {
      const built = () =>
        tracesWithoutLlm({ scope: proof(), windowed: true, innerWindowed: false }).build();

      expect(refusalOf(built)).toBe("missing-marker");
    });
  });
});
