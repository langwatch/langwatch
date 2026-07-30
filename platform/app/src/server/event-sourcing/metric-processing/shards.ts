import { sha256 } from "./canonical/serialization";
import {
  DEFAULT_METRIC_COMMAND_SHARDS,
  MAX_METRIC_COMMAND_SHARDS,
  MIN_METRIC_COMMAND_SHARDS,
} from "./constants";

/**
 * Hashed-shard sizing shared by every `partition` scope this pipeline
 * declares.
 *
 * A metric data point is its own aggregate, so an `aggregate`-scoped lane
 * would mint one lane per point ever received — unbounded lane cardinality.
 * `partition` scope on a hashed shard is the fix: a series (or point) always
 * lands in the same bounded lane, so work for it always serialises against
 * itself without the lane count growing with traffic. This is one of the
 * hashed-shard `partition` scopes ADR-100 names directly as a worked example.
 */
export function clampMetricShardCount(value: number): number {
  if (!Number.isFinite(value)) return MIN_METRIC_COMMAND_SHARDS;
  return Math.min(
    MAX_METRIC_COMMAND_SHARDS,
    Math.max(MIN_METRIC_COMMAND_SHARDS, Math.trunc(value)),
  );
}

export function resolveMetricShardCount(value: string | undefined): number {
  if (!value) return DEFAULT_METRIC_COMMAND_SHARDS;
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? clampMetricShardCount(parsed)
    : DEFAULT_METRIC_COMMAND_SHARDS;
}

/**
 * Deterministically spreads `identity` across a bounded set of lane labels.
 * The same identity always resolves to the same label, which is what makes
 * the lane a real serialisation boundary rather than a random one.
 */
export function metricShardLabel(args: {
  identity: string;
  shardCount: number;
}): string {
  const count = BigInt(clampMetricShardCount(args.shardCount));
  const lane = BigInt(`0x${sha256(args.identity).slice(0, 16)}`) % count;
  return lane.toString();
}
