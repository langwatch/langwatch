/**
 * The budget reads' bucket predicates as builder conditions, over the ledger and the rollup alike.
 * Every caller value is bound; the scope and window spellings arrive already converted.
 */
import {
  type Condition,
  type ConditionOps,
  type Expression,
  fn,
} from "@langwatch/clickhouse-client/builder";
import { PROVIDER_BUCKET_SEPARATOR } from "@langwatch/gateway-contract";

import { gatewayBudgetLedgerEvents as ledger } from "./clickhouse.gateway-budget-ledger-events.table.ts";

/** The bucket columns both budget tables carry. */
type BucketColumns<T extends string> = {
  readonly BudgetId: Expression<string, T>;
  readonly Scope: Expression<string, T>;
  readonly ScopeId: Expression<string, T>;
};

/** Which buckets a target sums: one, or every one under its key with its provider suffix. */
export type BucketMatch = {
  budgetId: string;
  scopeId: string;
  match?: "exact" | "prefix" | undefined;
  bucketSuffix?: string | null | undefined;
};

/** A bucket key with no provider suffix, so an unfiltered budget never takes a filtered one's. */
function unsuffixed<T extends string, C>({
  ops,
  columns,
}: {
  ops: ConditionOps<T, C>;
  columns: BucketColumns<T>;
}): Condition<T> {
  return ops.eq(fn.position(columns.ScopeId, PROVIDER_BUCKET_SEPARATOR), 0);
}

/** "This row belongs to this target": its budget, and its one bucket or its anchored buckets. */
export function bucketMatchCondition<T extends string, C>({
  ops,
  columns,
  target,
}: {
  ops: ConditionOps<T, C>;
  columns: BucketColumns<T>;
  target: BucketMatch;
}): Condition<T> {
  const budget = ops.eq(columns.BudgetId, target.budgetId);
  if (target.match !== "prefix") return ops.and(budget, ops.eq(columns.ScopeId, target.scopeId));
  return ops.and(
    budget,
    fn.startsWith(columns.ScopeId, target.scopeId),
    target.bucketSuffix
      ? fn.endsWith(columns.ScopeId, target.bucketSuffix)
      : unsuffixed({ ops, columns }),
  );
}

/** One target's ledger rows in its own period: scope, bucket, window and floor. */
export function flooredTargetCondition<C>({
  ops,
  target,
  scope,
  window,
  floorMs,
}: {
  ops: ConditionOps<"gateway_budget_ledger_events", C>;
  target: BucketMatch;
  scope: string;
  window: string;
  floorMs: number;
}): Condition<"gateway_budget_ledger_events"> {
  return ops.and(
    ops.eq(ledger.Scope, scope),
    bucketMatchCondition({ ops, columns: ledger, target }),
    ops.eq(ledger.Window, window),
    ops.gte(ledger.OccurredAt, floorMs),
  );
}

/** Every bucket of one fanned-out budget: its key prefix, and its provider suffix or none. */
export function budgetBucketsCondition<T extends string, C>({
  ops,
  columns,
  budgetId,
  scopeId,
  providerKey,
}: {
  ops: ConditionOps<T, C>;
  columns: BucketColumns<T>;
  budgetId: string;
  scopeId: string;
  providerKey: string | null | undefined;
}): Condition<T> {
  return ops.and(
    ops.eq(columns.BudgetId, budgetId),
    fn.startsWith(columns.ScopeId, `${scopeId}:`),
    providerKey
      ? fn.endsWith(columns.ScopeId, `${PROVIDER_BUCKET_SEPARATOR}${providerKey}`)
      : unsuffixed({ ops, columns }),
  );
}

/** A bucket with its own moved boundary reads from that boundary. */
export type BucketFloor = { bucketScopeId: string; floorMs: number };

/**
 * The ledger floor of a bucket breakdown: each moved bucket from its own boundary, and, when the
 * template has a floor of its own, every other bucket from that.
 */
export function bucketFloorCondition<C>({
  ops,
  moved,
  templateFloorMs,
}: {
  ops: ConditionOps<"gateway_budget_ledger_events", C>;
  moved: readonly BucketFloor[];
  templateFloorMs: number | undefined;
}): Condition<"gateway_budget_ledger_events"> {
  const movedTerms = moved.map((bucket) =>
    ops.and(
      ops.eq(ledger.ScopeId, bucket.bucketScopeId),
      ops.gte(ledger.OccurredAt, bucket.floorMs),
    ),
  );
  if (templateFloorMs === undefined) return ops.or(...movedTerms);
  const templateFloor = ops.gte(ledger.OccurredAt, templateFloorMs);
  if (movedTerms.length === 0) return templateFloor;
  const others = ops.not(
    ops.oneOf(
      ledger.ScopeId,
      moved.map((bucket) => bucket.bucketScopeId),
    ),
  );
  return ops.or(...movedTerms, ops.and(others, templateFloor));
}
