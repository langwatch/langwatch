/**
 * Which dimensions a spend rollup may be grouped by, and which of those a cursor
 * can safely walk.
 */

import { GatewaySettlementPolicyPort } from "../ports/gateway-settlement-policy.port";

import { GatewaySpendGroupByUnstableError } from "@langwatch/gateway-contract";
import { type SpendBucket, type SpendGroupByKey } from "../ports/gateway-spend-events.port";

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

/**
 * How a spend rollup is grouped and bucketed.
 */
export class GatewaySpendGroupingAdapter {
  static create(): GatewaySpendGroupingAdapter {
    return new GatewaySpendGroupingAdapter();
  }

  private constructor() {}

  groupByColumn(key: SpendGroupByKey): string {
    return COLUMN_BY_KEY[key];
  }

  /**
   * Whether this is a named zone the runtime knows.
   */
  isIanaTimeZone(zone: string): boolean {
    if (!/^[A-Za-z]/.test(zone)) return false;
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: zone });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * A time bucket rendered as a sortable string, so every grouping dimension is a String and one cursor comparison covers them all. The offset is applied
   * inside ClickHouse rather than after the fact: a day boundary is the caller's local midnight, and re-bucketing UTC days client-side cannot recover the
   * requests that fell on the other side of it.
   */
  bucketExpression({
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
  isMovableGroupBy(key: SpendGroupByKey): boolean {
    return MOVABLE_GROUP_BY_KEYS.includes(key);
  }

  /**
   * A window is settled once its end is older than the settlement grace: past
   * that, every admission inside it has either resolved or been settled by the
   * sweeper, so no fold is still waiting to rewrite a row's model or provider.
   */
  windowHasSettled({
    toMs,
    nowMs,
    settlementPolicy,
  }: {
    toMs: number;
    nowMs: number;
    settlementPolicy: GatewaySettlementPolicyPort;
  }): boolean {
    return toMs <= nowMs - settlementPolicy.graceMs();
  }

  /**
   * Refuse a grouping whose key can still move under the walk, unless the caller
   * has said they accept an inexact read.
   */
  assertGroupingIsWalkable({
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
    settlementPolicy: GatewaySettlementPolicyPort;
  }): void {
    if (allowUnstable) return;
    if (this.windowHasSettled({ toMs, nowMs, settlementPolicy })) return;
    const movable: string[] = keys.filter((key) => this.isMovableGroupBy(key));
    if (bucket !== "none") movable.push(`bucket:${bucket}`);
    if (movable.length === 0) return;
    throw new GatewaySpendGroupByUnstableError({
      groupBy: movable,
      settlesAtMs: toMs + settlementPolicy.graceMs(),
    });
  }
}
