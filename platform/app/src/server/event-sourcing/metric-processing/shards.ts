import { sha256 } from "./canonical/serialization";

/**
 * Every `partition` scope this pipeline declares spreads across these lanes. A
 * point is its own aggregate, so an aggregate-scoped lane would mint one lane
 * per point ever received; a hashed shard keeps the count bounded while a
 * series still always serialises against itself (ADR-100).
 */

export const DEFAULT_METRIC_SHARD_COUNT = 16;
export const MIN_METRIC_SHARD_COUNT = 1;
export const MAX_METRIC_SHARD_COUNT = 128;

export function clampMetricShardCount(value: number): number {
  if (!Number.isFinite(value)) return MIN_METRIC_SHARD_COUNT;
  return Math.min(
    MAX_METRIC_SHARD_COUNT,
    Math.max(MIN_METRIC_SHARD_COUNT, Math.trunc(value)),
  );
}

export function resolveMetricShardCount(value: string | undefined): number {
  if (!value) return DEFAULT_METRIC_SHARD_COUNT;
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? clampMetricShardCount(parsed)
    : DEFAULT_METRIC_SHARD_COUNT;
}

/** Stable per identity, which is what makes the lane a serialisation boundary. */
export function metricShardLabel(args: {
  identity: string;
  shardCount: number;
}): string {
  const count = BigInt(clampMetricShardCount(args.shardCount));
  const lane = BigInt(`0x${sha256(args.identity).slice(0, 16)}`) % count;
  return lane.toString();
}
