/**
 * The row coercions every coding-agent ClickHouse repository decodes with.
 *
 * There is no fan-out helper here any more. The module holds the process's one
 * ClickHouse client, which routes each statement to the server its tenant
 * belongs on, so a repository can neither resolve an endpoint nor group
 * tenants by one.
 */
import { Temporal, toDate, toEpochMs } from "@langwatch/time";

/** A moment as a ClickHouse INSERT carries it. The client serialises this into
 *  `DateTime64(3)`; an instant serialises to `{}`, so the conversion is here. */
export type ClickHouseMoment = ReturnType<typeof toDate>;

/** The instant a row is stamped with, as the INSERT wants it. */
export const clickHouseMomentOf = (epochMilliseconds: number): ClickHouseMoment =>
  toDate(Temporal.Instant.fromEpochMilliseconds(epochMilliseconds));

export const asNumber = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];

export const parseClickHouseDateTimeMs = (value: string): number => {
  const parsed = toEpochMs(value.replace(" ", "T") + "Z");
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * Why a pull-request rollup's statement carries no single-tenant predicate.
 *
 * The read IS scoped — `TenantId IN {tenantIds:Array(String)}` — but the tenant
 * guard checks a `TenantId = {param:String}` predicate against the one tenant
 * the request claims, and a list cannot be checked that way. The reason is
 * written down here rather than the predicate being widened into one the guard
 * would accept and the read would then answer wrongly.
 */
export const CROSS_TENANT_ROLLUP = {
  reason:
    "A pull-request rollup reads one organization's project tenants together, scoped by TenantId IN {tenantIds:Array(String)}.",
} as const;

/**
 * The tenant a cross-tenant rollup is routed by.
 *
 * A ClickHouse route is per ORGANIZATION, and every tenant in one of these
 * lists is a project of the single organization the rollup was resolved for,
 * so they all live on the same server and naming the first places the
 * statement on it. The lists are enumerated from one organization's own
 * projects and never taken from a request, which is what keeps that true.
 */
export function routingTenantOf(tenantIds: readonly string[]): string {
  const [first] = tenantIds;
  if (first === undefined) {
    throw new Error("A cross-tenant coding-agent read named no tenant to route by.");
  }
  return first;
}
