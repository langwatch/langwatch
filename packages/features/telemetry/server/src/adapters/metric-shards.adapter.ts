import {
  DEFAULT_METRIC_COMMAND_SHARDS,
  MAX_METRIC_COMMAND_SHARDS,
  MIN_METRIC_COMMAND_SHARDS,
} from "@langwatch/telemetry-contract";
import { sha256 } from "./metric-serialization.adapter";

function clampMetricCommandShardCount(value: number): number {
  if (!Number.isFinite(value)) return MIN_METRIC_COMMAND_SHARDS;
  return Math.min(
    MAX_METRIC_COMMAND_SHARDS,
    Math.max(MIN_METRIC_COMMAND_SHARDS, Math.trunc(value)),
  );
}

function resolveMetricCommandShardCount(value: string | undefined): number {
  if (!value) return DEFAULT_METRIC_COMMAND_SHARDS;
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? clampMetricCommandShardCount(parsed)
    : DEFAULT_METRIC_COMMAND_SHARDS;
}

/** Spreads a point across a bounded set of ordered lanes by its PointId. */
function metricCommandGroupKey({
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

/**
 * Routes map work across bounded lanes while keeping the same logical identity
 * serialized. Point storage uses PointId; series catalog and rollups use
 * SeriesId so concurrent points cannot race updates for one series.
 */
function metricMapGroupKey({
  identity,
  shardCount,
}: {
  identity: string;
  shardCount: number;
}): string {
  const count = BigInt(clampMetricCommandShardCount(shardCount));
  const lane = BigInt(`0x${sha256(identity).slice(0, 16)}`) % count;
  return `metric-map:${lane}`;
}

export class MetricShardsAdapter {
  private constructor() {}

  static create(): MetricShardsAdapter {
    return new MetricShardsAdapter();
  }
}

export {
  clampMetricCommandShardCount,
  metricCommandGroupKey,
  metricMapGroupKey,
  resolveMetricCommandShardCount,
};
