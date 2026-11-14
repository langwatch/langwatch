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

/**
 * The keys the fold rewrites after admission. Requested model and provider
 * are replaced by the resolved ones, so a row's group can move under a walk.
 */
export const MOVABLE_GROUP_BY_KEYS: readonly SpendGroupByKey[] = ["model", "provider"];

const COLUMN_BY_KEY = {
  virtual_key: "VirtualKeyId",
  end_user: "EndUserId",
  project: "TenantId",
  model: "Model",
  provider: "ProviderKey",
  principal: "PrincipalUserId",
  request_type: "RequestType",
} as const satisfies Record<SpendGroupByKey, string>;

/** The `gateway_spend` column a rollup groups on for one key. */
export function groupByColumn(key: SpendGroupByKey): (typeof COLUMN_BY_KEY)[SpendGroupByKey] {
  return COLUMN_BY_KEY[key];
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

export interface GatewaySettlementPolicy {
  graceMs(): number;
}
