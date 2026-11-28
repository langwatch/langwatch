/**
 * A tenant marker is a top-level AND conjunct of its own select's WHERE, or the fence refuses the
 * statement before expanding it: no OR, XOR or NOT at its level, no bracket holding an OR around
 * it, never in HAVING, a SELECT list or an ON. Spec: specs/governance/aggregate-project.feature
 */
import { type Authorization, sealAuthorization } from "@langwatch/authorization";
import {
  tenantScope,
  tenantScopeForLatestVersion,
  tenantScopeWithConditions,
  tenantSet,
} from "@langwatch/clickhouse-markers";
import { describe, expect, it } from "vitest";

import { expandFragment, expandStatement, fenceFor } from "../authorized-reads.ts";
import { StatementScopeError, type StatementScopeViolation } from "../statementScopeError.ts";

const NOW = 1_800_000_000_000;

function proof(): Authorization {
  return sealAuthorization({
    actor: { type: "user", id: "ana" },
    principal: { type: "user", id: "ana" },
    scope: { organizationId: "org_acme" },
    grants: [
      { projectId: "proj_aggregate", permissions: ["traces:view"], via: [], kind: "own" },
      {
        projectId: "proj_member",
        permissions: ["traces:view"],
        via: ["grant_member"],
        kind: "shared",
        condition: { type: "trace", from: NOW - 1000, until: null },
      },
    ],
    expiresAt: NOW + 60_000,
    purpose: { kind: "route", route: "tracesV2.list" },
  });
}

const fence = fenceFor({ authorization: proof(), reads: "traces" });
const PARAMS = { name: "n", traceId: "tr-1", from: 1, to: 2 };

function violationOf(render: () => unknown): StatementScopeViolation | undefined {
  try {
    render();
    return undefined;
  } catch (error) {
    if (error instanceof StatementScopeError) return error.violation;
    throw error;
  }
}

const statementViolation = (query: string) =>
  violationOf(() => expandStatement({ query, queryParams: PARAMS, fence }));

const SCOPE = tenantScope("OccurredAt");
const FROM = "SELECT TraceId FROM trace_summaries";

/** Every marker the fence writes a tenant set for, in the select it would sit in. */
const MARKERS = [
  ["the tenant marker", SCOPE, ""],
  ["the conditions marker", tenantScopeWithConditions("OccurredAt"), ""],
  ["the set marker", tenantSet(), ` AND TraceId IN (SELECT TraceId FROM t WHERE ${SCOPE})`],
] as const;

/** Each shape puts `m` somewhere a row of another tenant could get through. */
const LOOSE_SHAPES: readonly (readonly [string, (m: string) => string])[] = [
  ["an OR after the marker", (m) => `${FROM} WHERE ${m} OR Name = {name:String}`],
  ["an OR before the marker", (m) => `${FROM} WHERE Name = {name:String} OR ${m}`],
  ["an OR before an AND-ed marker", (m) => `${FROM} WHERE Name = {name:String} OR 1 = 1 AND ${m}`],
  ["an XOR beside the marker", (m) => `${FROM} WHERE ${m} XOR Name = {name:String}`],
  ["a NOT before the marker", (m) => `${FROM} WHERE NOT ${m}`],
  ["a not() around the marker", (m) => `${FROM} WHERE not(${m}) AND Name = {name:String}`],
  ["the marker inside an OR group", (m) => `${FROM} WHERE (${m} OR Name = {name:String})`],
  [
    "the marker in an AND group under an OR",
    (m) => `${FROM} WHERE (Name = {name:String} AND ${m}) OR 1 = 1`,
  ],
  [
    "the marker in a HAVING",
    (m) => `${FROM} WHERE Name = {name:String} GROUP BY TraceId HAVING ${m}`,
  ],
  [
    "the marker in a SELECT list",
    (m) => `SELECT TraceId, ${m} AS fenced FROM trace_summaries WHERE Name = {name:String}`,
  ],
  [
    "the marker in a JOIN's ON",
    (m) => `${FROM} AS a JOIN trace_summaries AS b ON ${m} AND a.TraceId = b.TraceId WHERE 1 = 1`,
  ],
  ["the marker compared", (m) => `${FROM} WHERE ${m} = 0`],
  ["the marker as a BETWEEN bound", (m) => `${FROM} WHERE OccurredAt BETWEEN 0 AND ${m}`],
  ["the marker as a ternary's branch", (m) => `${FROM} WHERE 1 ? 1 : ${m}`],
  ["the marker in a CASE", (m) => `${FROM} WHERE CASE WHEN 1 THEN 1 ELSE 0 AND ${m} AND 1 END`],
  ["the marker as an IN list", (m) => `${FROM} WHERE 1 IN (${m})`],
  [
    "the marker in a subquery's OR arm",
    (m) => `${FROM} WHERE ${SCOPE} AND TraceId IN (SELECT TraceId FROM t WHERE ${m} OR 1 = 1)`,
  ],
  ["the marker in a comment", (m) => `${FROM} WHERE 1 = 1 -- ${m}`],
  ["the marker in a string", (m) => `${FROM} WHERE Name = '${m}'`],
  ["an unbalanced bracket", (m) => `${FROM} WHERE ${m} AND (1 = 1`],
];

describe("expandStatement, given a tenant marker that is not a top-level AND conjunct of its WHERE", () => {
  describe.each(MARKERS)("when %s is placed loosely", (_marker, marker, beside) => {
    /** @scenario "A tenant marker is only ever a top-level AND conjunct of its WHERE" */
    it.each(LOOSE_SHAPES)("refuses %s", (_shape, shape) => {
      const query = `${shape(marker)}${beside}`;

      expect(statementViolation(query)).toMatchObject({ kind: "loose-tenant-marker" });
    });
  });

  describe("when two markers sit in one statement and one is in an OR arm", () => {
    /** @scenario "A tenant marker is only ever a top-level AND conjunct of its WHERE" */
    it("refuses the statement, though the other marker is a conjunct", () => {
      const query =
        `${FROM} WHERE ${SCOPE} AND TraceId IN` +
        ` (SELECT TraceId FROM stored_spans WHERE Name = {name:String} OR ${tenantSet()})`;

      expect(statementViolation(query)).toMatchObject({ kind: "loose-tenant-marker" });
    });
  });

  describe("when the latest-version marker sits in an OR arm of its election", () => {
    /** @scenario "A tenant marker is only ever a top-level AND conjunct of its WHERE" */
    it("refuses the statement", () => {
      const query =
        `SELECT SpanId FROM stored_spans WHERE ${tenantScope("StartTime")}` +
        " AND (TenantId, TraceId, SpanId, UpdatedAt) IN (SELECT TenantId, TraceId, SpanId," +
        ` max(UpdatedAt) FROM stored_spans WHERE ${tenantScopeForLatestVersion("StartTime")}` +
        " OR 1 = 1 GROUP BY TenantId, TraceId, SpanId)";

      // The election's own allow-list may refuse it first; either refusal keeps it out.
      expect(["loose-tenant-marker", "loose-latest-version-marker"]).toContain(
        statementViolation(query)?.kind,
      );
    });
  });

  describe("when the refusal is read", () => {
    it("says what to write instead", () => {
      const message = (() => {
        try {
          expandStatement({ query: `${FROM} WHERE ${SCOPE} OR 1 = 1`, queryParams: {}, fence });
        } catch (error) {
          return error instanceof Error ? error.message : "";
        }
        return "";
      })();

      expect(message).toContain(`WHERE ${SCOPE} AND (`);
    });

    it("says a marker outside the WHERE belongs in it", () => {
      expect(
        statementViolation(`SELECT ${SCOPE} FROM trace_summaries WHERE ${SCOPE}`),
      ).toMatchObject({ kind: "loose-tenant-marker", placement: "outside-where" });
    });
  });
});

describe("expandFragment, given a WHERE fragment whose marker is not a top-level conjunct", () => {
  /** @scenario "A tenant marker is only ever a top-level AND conjunct of its WHERE" */
  it.each([
    ["an OR beside the marker", `${tenantSet()} OR 1 = 1`],
    ["a NOT before the marker", `NOT ${tenantSet()}`],
    [
      "an OR inside the subquery that holds it",
      `EXISTS (SELECT 1 FROM evaluation_runs es WHERE ${tenantSet()} OR es.TraceId = ts.TraceId)`,
    ],
  ])("refuses %s", (_shape, fragment) => {
    expect(violationOf(() => expandFragment({ fragment, queryParams: {}, fence }))).toMatchObject({
      kind: "loose-tenant-marker",
    });
  });
});

/**
 * The shapes the repositories write, copied from them: trace list, dedup election, coding-agent
 * sessions, rollup timeseries, span storage with its id bound, filter subqueries under an OR.
 */
const REPOSITORY_STATEMENTS: readonly (readonly [string, string])[] = [
  [
    "a list whose conditions are joined with AND",
    `SELECT TraceId FROM trace_summaries WHERE ${[
      SCOPE,
      "OccurredAt >= fromUnixTimestamp64Milli({from:Int64})",
      "OccurredAt <= fromUnixTimestamp64Milli({to:Int64})",
    ].join(" AND ")} ORDER BY OccurredAt DESC LIMIT 10`,
  ],
  [
    "a dedup election under the set marker",
    `SELECT * FROM coding_agent_sessions WHERE ${tenantScope("StartedAt")}
      AND StartedAt BETWEEN fromUnixTimestamp64Milli({from:Int64}) AND fromUnixTimestamp64Milli({to:Int64})
      AND (TenantId, SessionId, UpdatedAt) IN (
        SELECT TenantId, SessionId, max(UpdatedAt) FROM coding_agent_sessions
        WHERE ${tenantSet()} AND StartedAt >= now() - INTERVAL 7 DAY
        GROUP BY TenantId, SessionId HAVING max(toUInt8(Auxiliary)) = 0
      ) ORDER BY StartedAt DESC LIMIT {limit:UInt32}`,
  ],
  [
    "a rollup whose OR sits inside its own bracket",
    `SELECT count() FROM trace_minute_rollups ra WHERE ${tenantScope("BucketStart")}
      AND (
        (ra.BucketStart >= {currentStart:DateTime64(3)} AND ra.BucketStart < {currentEnd:DateTime64(3)})
        OR
        (ra.BucketStart >= {previousStart:DateTime64(3)} AND ra.BucketStart < {previousEnd:DateTime64(3)})
      ) GROUP BY period ORDER BY period`,
  ],
  [
    "a span read with an id bound and a latest-version election",
    `SELECT SpanId, "Events.Name" AS event_name FROM stored_spans
      ARRAY JOIN "Events.Name" AS name
      WHERE ${tenantScope("StartTime")} AND TraceId = {traceId:String}
        {{idBound:stored_spans.TraceId:traceId}}
        AND (TenantId, TraceId, SpanId, UpdatedAt) IN (
          SELECT TenantId, TraceId, SpanId, max(UpdatedAt) FROM stored_spans
          WHERE ${tenantScopeForLatestVersion("StartTime")} AND TraceId = {traceId:String}
          GROUP BY TenantId, TraceId, SpanId
        ) ORDER BY StartTime`,
  ],
  [
    "filter subqueries the translator joins with OR",
    `SELECT TraceId FROM trace_summaries ts WHERE ${SCOPE} AND (
        (ts.TenantId, ts.TraceId) IN (SELECT TenantId, TraceId FROM stored_spans WHERE ${tenantSet()} AND SpanName = {name:String})
        OR EXISTS (SELECT 1 FROM evaluation_runs es WHERE ${tenantSet()} AND es.TenantId = ts.TenantId AND es.TraceId IS NOT NULL)
      )`,
  ],
  [
    "a marker in a bracket of AND-ed terms, with a comment and a quoted literal",
    `SELECT TraceId FROM trace_summaries -- the list
      WHERE (${SCOPE} AND Attributes['gen_ai.conversation.id'] = {name:String})
        AND NOT empty(TraceId) AND Name LIKE '%OR%'`,
  ],
  [
    "a union whose arms each carry the marker",
    `SELECT TraceId FROM trace_summaries WHERE ${SCOPE} AND TraceId = {traceId:String}
      UNION ALL SELECT TraceId FROM trace_summaries WHERE ${SCOPE} LIMIT 1`,
  ],
];

describe("expandStatement, given the shapes the repositories write", () => {
  /** @scenario "A tenant marker is only ever a top-level AND conjunct of its WHERE" */
  it.each(REPOSITORY_STATEMENTS)("renders %s", (_shape, query) => {
    const rendered = expandStatement({ query, queryParams: PARAMS, fence });

    expect(rendered.query).toContain("TenantId IN ({tenantScope_all:Array(String)})");
    expect(rendered.query).not.toContain("{{tenant");
  });

  it("renders a legacy filter fragment whose markers sit in EXISTS subqueries", () => {
    const fragment =
      `(EXISTS (SELECT 1 FROM evaluation_runs es WHERE ${tenantSet()} AND es.TenantId = ts.TenantId)` +
      ` OR EXISTS (SELECT 1 FROM stored_spans sp WHERE ${tenantSet()} AND sp.TraceId = ts.TraceId))`;

    const rendered = expandFragment({ fragment, queryParams: {}, fence });

    expect(rendered.sql).not.toContain("{{tenant");
  });
});
