import {
  DEFAULT_METRIC_COMMAND_SHARDS,
  MAX_METRIC_COMMAND_SHARDS,
  MIN_METRIC_COMMAND_SHARDS,
} from "../schemas/constants";
import { sha256 } from "./serialization";

export function clampMetricCommandShardCount(value: number): number {
  if (!Number.isFinite(value)) return MIN_METRIC_COMMAND_SHARDS;
  return Math.min(
    MAX_METRIC_COMMAND_SHARDS,
    Math.max(MIN_METRIC_COMMAND_SHARDS, Math.trunc(value)),
  );
}

export function resolveMetricCommandShardCount(
  value: string | undefined,
): number {
  if (!value) return DEFAULT_METRIC_COMMAND_SHARDS;
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? clampMetricCommandShardCount(parsed)
    : DEFAULT_METRIC_COMMAND_SHARDS;
}

/** Spreads a point across a bounded set of ordered lanes by its PointId. */
export function metricCommandGroupKey({
  pointId,
  shardCount,
}: {
  pointId: string;
  shardCount: number;
}): string {
  const count = BigInt(clampMetricCommandShardCount(shardCount));
  const lane = BigInt(`0x${sha256(pointId).slice(0, 16)}`) % count;
  return `metric:${lane}`;
}
