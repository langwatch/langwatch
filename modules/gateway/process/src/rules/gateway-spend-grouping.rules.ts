/**
 * Which dimensions a spend rollup may be grouped by, and which of those a cursor
 * can safely walk.
 */

import {
  GATEWAY_MAX_EPOCH_MS,
  GatewaySpendGroupByUnstableError,
  type SpendBucket,
  type SpendGroupByKey,
} from "@langwatch/gateway-contract";

import type { GatewaySettlementPolicy } from "../app/gateway.members.ts";

/**
 * The keys the fold rewrites after admission. Requested model and provider
 * are replaced by the resolved ones, so a row's group can move under a walk.
 */
export const MOVABLE_GROUP_BY_KEYS: readonly SpendGroupByKey[] = ["model", "provider"];

const COLUMN_BY_KEY: Record<SpendGroupByKey, string> = {
  virtual_key: "VirtualKeyId",
  end_user: "EndUserId",
  project: "TenantId",
  model: "Model",
  provider: "ProviderKey",
  principal: "PrincipalUserId",
  request_type: "RequestType",
};

/**
 * How a spend rollup is grouped and bucketed.
 */
export function groupByColumn(key: SpendGroupByKey): string {
  return COLUMN_BY_KEY[key];
}

/**
 * A time bucket as a sortable string, so one cursor comparison covers every
 * grouping dimension. The offset applies inside ClickHouse, not after — a
 * client-side re-bucket of UTC days can't recover requests on the far side.
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
 */
export function windowHasSettled({
  toMs,
  nowMs,
  settlementPolicy,
}: {
  toMs: number;
  nowMs: number;
  settlementPolicy: GatewaySettlementPolicy;
}): boolean {
  return toMs <= nowMs - settlementPolicy.graceMs();
}

/**
 * Refuse a grouping whose key can still move under the walk, unless the caller
 * has said they accept an inexact read.
 */
export function assertGroupingIsWalkable({
  keys,
  bucket,
  toMs,
  nowMs,
  allowUnstable,
  settlementPolicy,
}: {
  keys: SpendGroupByKey[];
  bucket: SpendBucket;
  toMs: number;
  nowMs: number;
  allowUnstable: boolean;
  settlementPolicy: GatewaySettlementPolicy;
}): void {
  if (allowUnstable) return;
  if (windowHasSettled({ toMs, nowMs, settlementPolicy })) return;
  const movable: string[] = keys.filter((key) => isMovableGroupBy(key));
  if (bucket !== "none") movable.push(`bucket:${bucket}`);
  if (movable.length === 0) return;
  throw new GatewaySpendGroupByUnstableError({
    groupBy: movable,
    // A window ending past the last representable moment settles at that moment.
    settlesAtMs: Math.min(toMs + settlementPolicy.graceMs(), GATEWAY_MAX_EPOCH_MS),
  });
}
