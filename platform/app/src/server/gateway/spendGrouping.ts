/**
 * Which dimensions a spend rollup may be grouped by, and which of those a
 * cursor can safely walk.
 *
 * The rollup pages by group key ascending, which is exact only while a row's
 * group key cannot change. Most of them cannot: where a request landed, whose
 * key served it, which end user and principal it was attributed to, and what
 * wire shape it used are all fixed when the request is admitted. Two are not.
 * The fold overwrites `Model` and `ProviderKey` when the values the caller
 * ASKED for are replaced by the ones that actually served the request, so a
 * late outcome can move a row from one group to another. A walk that crosses
 * that boundary serves the row twice or not at all, and a reconciliation
 * checksum that silently drops rows is worse than one that refuses.
 *
 * So a grouping on a movable key is refused while the window can still
 * change, and served once it has settled.
 */

import { settlementGraceMs } from "../event-sourcing/pipelines/gateway-spend-processing/process-manager/spendSettlement.process";

import { GatewaySpendGroupByUnstableError } from "./errors";

export const SPEND_GROUP_BY_KEYS = [
  "virtual_key",
  "end_user",
  "project",
  "model",
  "provider",
  "principal",
  "request_type",
] as const;

export type SpendGroupByKey = (typeof SPEND_GROUP_BY_KEYS)[number];

/**
 * The keys the fold rewrites after admission. Requested model and provider
 * are replaced by the resolved ones, so a row's group can move under a walk.
 */
export const MOVABLE_GROUP_BY_KEYS: readonly SpendGroupByKey[] = ["model", "provider"];

/** At most two: a third dimension multiplies the group count past what a
 *  single cursor walk can serve at a useful page size. */
export const MAX_GROUP_BY_KEYS = 2;

const COLUMN_BY_KEY: Record<SpendGroupByKey, string> = {
  virtual_key: "VirtualKeyId",
  end_user: "EndUserId",
  project: "TenantId",
  model: "Model",
  provider: "ProviderKey",
  principal: "PrincipalUserId",
  request_type: "RequestType",
};

export function groupByColumn(key: SpendGroupByKey): string {
  return COLUMN_BY_KEY[key];
}

export const SPEND_BUCKETS = ["none", "hour", "day"] as const;
export type SpendBucket = (typeof SPEND_BUCKETS)[number];

/**
 * Whether this is a named zone the runtime knows.
 *
 * Asked before the query is built so an unknown zone is a 400 naming
 * `timezone`. ClickHouse would otherwise refuse it in `formatDateTime` and the
 * caller would read an unknown error about a value they chose. Existence is
 * checked by a construction attempt rather than against a list, because the
 * zone database ships with the runtime and any list here would go stale
 * against it.
 *
 * A fixed offset is refused even though the runtime accepts it. `Intl` takes
 * `+05:00`, `+0500` and `-08:00`; ClickHouse loads zones by name only and
 * answers `Cannot load time zone +05:00`, which would reach the caller as an
 * unknown error rather than the documented refusal. Every named zone starts
 * with a letter and no offset spelling does, so the first character settles
 * it.
 */
export function isIanaTimeZone(zone: string): boolean {
  if (!/^[A-Za-z]/.test(zone)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/**
 * A time bucket rendered as a sortable string, so every grouping dimension is
 * a String and one cursor comparison covers them all. The offset is applied
 * inside ClickHouse rather than after the fact: a day boundary is the
 * caller's local midnight, and re-bucketing UTC days client-side cannot
 * recover the requests that fell on the other side of it.
 */
export function bucketExpression({
  bucket,
  timezoneParam,
}: {
  bucket: Exclude<SpendBucket, "none">;
  timezoneParam: string;
}): string {
  const start = bucket === "hour" ? "toStartOfHour" : "toStartOfDay";
  const format = bucket === "hour" ? "%Y-%m-%dT%H:00:00" : "%Y-%m-%d";
  return `formatDateTime(${start}(OccurredAt, {${timezoneParam}:String}), '${format}', {${timezoneParam}:String})`;
}

/** True when a late outcome can still move a row between groups on this key. */
export function isMovableGroupBy(key: SpendGroupByKey): boolean {
  return MOVABLE_GROUP_BY_KEYS.includes(key);
}

/**
 * A window is settled once its end is older than the settlement grace: past
 * that, every admission inside it has either resolved or been settled by the
 * sweeper, so no fold is still waiting to rewrite a row's model or provider.
 *
 * The grace is read from the settlement process manager rather than restated
 * here, so an operator who widens `LW_SPEND_SETTLEMENT_GRACE_MS` widens this
 * guard with it instead of leaving two numbers to disagree.
 */
export function windowHasSettled({
  toMs,
  nowMs,
}: {
  toMs: number;
  nowMs: number;
}): boolean {
  return toMs <= nowMs - settlementGraceMs();
}

/**
 * Refuse a grouping whose key can still move under the walk, unless the
 * caller has said they accept an inexact read.
 *
 * A time bucket counts as movable for the same reason model and provider do,
 * and for a subtler cause: the fold's admitted handler sets the occurred-at
 * unconditionally while every outcome handler preserves the one already
 * there, so an outcome that races ahead of its own admission has its instant
 * rewritten when the admission lands. A request can therefore change buckets,
 * and over a month boundary change partitions.
 */
export function assertGroupingIsWalkable({
  keys,
  bucket,
  toMs,
  nowMs,
  allowUnstable,
}: {
  keys: SpendGroupByKey[];
  bucket: SpendBucket;
  toMs: number;
  nowMs: number;
  allowUnstable: boolean;
}): void {
  if (allowUnstable) return;
  if (windowHasSettled({ toMs, nowMs })) return;
  const movable: string[] = keys.filter(isMovableGroupBy);
  if (bucket !== "none") movable.push(`bucket:${bucket}`);
  if (movable.length === 0) return;
  throw new GatewaySpendGroupByUnstableError({
    groupBy: movable,
    settlesAtMs: toMs + settlementGraceMs(),
  });
}
