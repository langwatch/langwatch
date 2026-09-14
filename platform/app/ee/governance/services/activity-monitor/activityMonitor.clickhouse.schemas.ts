// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Shared Zod schemas, attribute-key constants, and the ORDER BY whitelist
 * used by the three ActivityMonitor ClickHouse repositories (spend, events,
 * health). Split out of `activityMonitor.clickhouse.repository.ts` so each
 * repository file stays under the repo's 300-line SRP limit.
 *
 * Every query result is validated through a Zod schema before returning.
 * ClickHouse is a trust boundary: rows can carry nulls from JOINs, strings
 * for aggregated numerics (sum, count, uniqExact all return String in
 * JSONEachRow when the value is large), and silently renamed columns after
 * a migration. Zod `.parse()` at the read boundary catches all three;
 * `.catch()` on individual fields provides safe defaults for the expected
 * variations.
 *
 * Convention: Zod where untrusted data enters, `z.infer<>` for the type.
 * Internal orchestration contracts stay as plain `interface` in the service.
 */
import { z } from "zod";

import {
  GOVERNANCE_ATTR,
  GOVERNANCE_ORIGIN_KIND_VALUE,
} from "../governanceAttributeKeys";

// ---------------------------------------------------------------------------
// Shared types (service ↔ repository)
// ---------------------------------------------------------------------------

/** Sort field accepted by `spendByUser` / `spendByTeam`. */
export type SpendSortField = "spend" | "requests" | "lastActivity";
/**
 * What the PERSON read may be sorted by, which is one more thing than the
 * team read.
 *
 * Tokens only: the per-person read counts them off `trace_summaries`, and the
 * team rollup has no token figure to order by at all. Widening the shared
 * field instead would make `spendByTeam` accept a sort it cannot honour.
 */
export type SpendByUserSortField = SpendSortField | "tokens";
export type SortDir = "asc" | "desc";
export type SpendOverTimeGroupBy = "team" | "user" | "model";

// ---------------------------------------------------------------------------
// Attribute key constants
// ---------------------------------------------------------------------------

export const ATTR_ORIGIN_KIND = GOVERNANCE_ATTR.ORIGIN_KIND;
export const ATTR_INGESTION_SOURCE_ID = GOVERNANCE_ATTR.INGESTION_SOURCE_ID;
export const ATTR_INGESTION_SOURCE_TYPE = GOVERNANCE_ATTR.INGESTION_SOURCE_TYPE;
export const ATTR_USER_ID = GOVERNANCE_ATTR.USER_ID;
export const ORIGIN_KIND_VALUE = GOVERNANCE_ORIGIN_KIND_VALUE;

// ---------------------------------------------------------------------------
// SQL injection boundary — whitelist for ORDER BY interpolation
// ---------------------------------------------------------------------------

/**
 * Whitelist mapping from external sort field names to the aggregate
 * expressions we splice into the ORDER BY clause. CH parameter binding
 * does NOT support column-name interpolation; this whitelist is the
 * boundary that prevents injection through the public API.
 */
export const SORT_FIELD_TO_AGG_EXPR: Record<SpendByUserSortField, string> = {
  spend: "sum(spendUsd)",
  requests: "count()",
  lastActivity: "max(occurredAt)",
  // The subquery's numeric columns, never the outer `tokensStr` alias — the
  // same trap the `spendUsd` / `spendUsdStr` split above exists for: ordering
  // by an alias that is a String makes this a sum over String and the query
  // fails with ILLEGAL_TYPE_OF_ARGUMENT. A person with no counted trace sums
  // to zero here and lands at the bottom of a descending page, which is where
  // an unmeasured row belongs.
  tokens: "sum(coalesce(promptTokens, 0) + coalesce(completionTokens, 0))",
};

// ---------------------------------------------------------------------------
// Zod schemas — trust boundary between ClickHouse and application
// ---------------------------------------------------------------------------

/**
 * CH aggregates (sum, count, uniqExact) can return number or string in
 * JSONEachRow depending on the column type and value size. `z.coerce.number()`
 * handles both; `.finite()` rejects NaN/Infinity; `.catch(0)` defaults on
 * any parse failure.
 */
export const chNumeric = z.coerce.number().finite().catch(0);

// -- 1. Summary spend --

export const summarySpendRowSchema = z.object({
  thisSpend: chNumeric,
  prevSpend: chNumeric,
  thisUsers: chNumeric,
});
export type SummarySpendChRow = z.infer<typeof summarySpendRowSchema>;

export const EMPTY_SUMMARY_SPEND: SummarySpendChRow = {
  thisSpend: 0,
  prevSpend: 0,
  thisUsers: 0,
};

// -- 1b. Active people, org-wide --

/**
 * Headcount only. Adoption is an organization question, so this row comes
 * from a read scoped to every project of the org, while the money fields
 * above keep the governance project's scope.
 */
export const activeUserCountRowSchema = z.object({
  thisUsers: chNumeric,
});
export type ActiveUserCountChRow = z.infer<typeof activeUserCountRowSchema>;

export const EMPTY_ACTIVE_USER_COUNT: ActiveUserCountChRow = {
  thisUsers: 0,
};

// -- 2. Spend by user --

export const spendByUserRowSchema = z.object({
  actor: z.string(),
  spendUsdStr: z.string(),
  requests: z.string(),
  lastActivityMs: z.string(),
  mostUsedTarget: z.string().nullable().catch(null),
  /**
   * Prompt + completion tokens summed over the person's traces, or NULL when
   * not one of them carried a count. Read `tokensStr` on
   * `spendByDepartmentRowSchema` for why NULL rather than zero.
   */
  tokensStr: z.string().nullable().catch(null),
  /** "1" when any counted trace of theirs was estimated, not reported. */
  tokensEstimatedStr: z.string().catch("0"),
});
export type SpendByUserChRow = z.infer<typeof spendByUserRowSchema>;

// -- 3. Spend by department (multi-tenant, per project×actor) --

export const spendByDepartmentRowSchema = z.object({
  projectId: z.string(),
  actor: z.string(),
  spendUsdStr: z.string(),
  requests: z.string(),
  lastActivityMs: z.string(),
  /**
   * Prompt + completion tokens summed over the group, or NULL when not one
   * row of it carried a count.
   *
   * NULL rather than a separate "how many rows were measured" column: the
   * distinction the screen needs is only ever "we measured this" against "we
   * did not", and a zero is a measurement. Subscription products carry no
   * per-request cost and some carry no token count either, so a group of them
   * has to come back distinguishable from a group that genuinely ran nothing.
   * `.catch(null)` for the same reason `mostUsedTarget` has one, and it
   * degrades the honest way: a column this read cannot see is not a
   * measurement of zero.
   */
  tokensStr: z.string().nullable().catch(null),
  /**
   * "1" when any counted row of the group had its tokens ESTIMATED rather
   * than reported by the provider. A string because everything else here is
   * one, and ClickHouse hands booleans back as `true`/`1` depending on the
   * cast.
   */
  tokensEstimatedStr: z.string().catch("0"),
});
export type SpendByDepartmentChRow = z.infer<typeof spendByDepartmentRowSchema>;

// -- 4. Spend by team source --

export const spendByTeamSourceRowSchema = z.object({
  sourceId: z.string(),
  thisSpendStr: z.string(),
  prevSpendStr: z.string(),
  thisRequests: z.string(),
  lastActivityMs: z.string(),
});
export type SpendByTeamSourceChRow = z.infer<typeof spendByTeamSourceRowSchema>;

// -- 5. Spend over time --

export const spendOverTimeRowSchema = z.object({
  bucketMs: z.string(),
  groupKey: z.string().nullable().catch(null),
  spendUsdStr: z.string(),
});
export type SpendOverTimeChRow = z.infer<typeof spendOverTimeRowSchema>;

// -- 6–8. Source event counts --

export const sourceEventCountRowSchema = z.object({
  sourceId: z.string(),
  c: z.string(),
});
export type SourceEventCountChRow = z.infer<typeof sourceEventCountRowSchema>;

// -- 9. Pushed event details --

export const pushedEventRowSchema = z.object({
  eventId: z.string(),
  eventType: z.string().catch(""),
  actor: z.string().catch(""),
  target: z.string().nullable().catch(null),
  costUsd: z.union([z.string(), z.number()]).transform(String).catch("0"),
  tokensInput: chNumeric,
  tokensOutput: chNumeric,
  occurredMs: z.string(),
  createdMs: z.string(),
});
export type PushedEventChRow = z.infer<typeof pushedEventRowSchema>;

// -- 10. Pulled event details --

export const pulledEventRowSchema = z.object({
  eventId: z.string(),
  eventType: z.string().catch(""),
  actorUserId: z.string().catch(""),
  actorEmail: z.string().catch(""),
  actorEnduserId: z.string().catch(""),
  action: z.string().catch(""),
  target: z.string().catch(""),
  occurredMs: z.string(),
  createdMs: z.string(),
  rawPayload: z.string().catch(""),
});
export type PulledEventChRow = z.infer<typeof pulledEventRowSchema>;

// -- 11–13. Window counts (24h/7d/30d) --

export const windowCountRowSchema = z.object({
  c24: chNumeric,
  c7: chNumeric,
  c30: chNumeric,
  lastMs: z.string().nullable().catch(null),
});
export type WindowCountChRow = z.infer<typeof windowCountRowSchema>;
