// Row coercions for coding-agent ClickHouse repositories; client routes
// statements by tenant, so repositories don't resolve endpoints.
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

// Rollup uses TenantId IN array predicate, not single-tenant, because tenant
// guard checks single value; avoids widening guard to match wrong scope.
export const CROSS_TENANT_ROLLUP = {
  reason:
    "A pull-request rollup reads one organization's project tenants together, scoped by TenantId IN {tenantIds:Array(String)}.",
} as const;

/** Route cross-tenant rollup by first tenant (all share one organization). */
export function routingTenantOf(tenantIds: readonly string[]): string {
  const [first] = tenantIds;
  if (first === undefined) {
    throw new Error("A cross-tenant coding-agent read named no tenant to route by.");
  }
  return first;
}
