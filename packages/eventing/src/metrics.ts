import { performance } from "node:perf_hooks";
import { Counter, Histogram, register } from "prom-client";

type CounterMetric = Counter<string>;
type HistogramMetric = Histogram<string>;

function counter(
  name: string,
  help: string,
  labelNames: readonly string[],
): CounterMetric {
  return (
    (register.getSingleMetric(name) as CounterMetric | undefined) ??
    new Counter({ name, help, labelNames })
  );
}

function histogram(
  name: string,
  help: string,
  labelNames: readonly string[],
  buckets = [1, 5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000],
): HistogramMetric {
  return (
    (register.getSingleMetric(name) as HistogramMetric | undefined) ??
    new Histogram({ name, help, labelNames, buckets })
  );
}

const projectionTotal = counter("es_projection_total", "Eventing projection executions", [
  "pipeline_name",
  "projection_kind",
  "projection_name",
  "status",
]);
const projectionDuration = histogram(
  "es_projection_duration_milliseconds",
  "Eventing projection execution duration",
  ["pipeline_name", "projection_kind", "projection_name"],
);
const commandTotal = counter("es_command_total", "Eventing commands processed", [
  "pipeline_name",
  "command_type",
  "status",
]);
const commandDuration = histogram(
  "es_command_duration_milliseconds",
  "Eventing command duration",
  ["pipeline_name", "command_type"],
);
const foldTotal = counter(
  "es_fold_projection_total",
  "Eventing ClickHouse fold executions",
  ["pipeline_name", "projection_name", "status"],
);
const foldDuration = histogram(
  "es_fold_projection_duration_milliseconds",
  "Eventing ClickHouse fold duration",
  ["pipeline_name", "projection_name"],
);
const mapTotal = counter(
  "es_map_projection_total",
  "Eventing ClickHouse map executions",
  ["pipeline_name", "projection_name", "status"],
);
const mapDuration = histogram(
  "es_map_projection_duration_milliseconds",
  "Eventing ClickHouse map duration",
  ["pipeline_name", "projection_name"],
);
const mapEnqueueTotal = counter(
  "es_map_projection_enqueue_total",
  "Eventing ClickHouse map routing outcomes",
  ["pipeline_name", "projection_name", "outcome"],
);
const projectionSubscriberTotal = counter(
  "es_reactor_total",
  "Eventing projection subscriber executions",
  ["pipeline_name", "reactor_name", "status"],
);
const projectionSubscriberDuration = histogram(
  "es_reactor_duration_milliseconds",
  "Eventing projection subscriber duration",
  ["pipeline_name", "reactor_name"],
);
const projectionSubscriberCollapsed = counter(
  "es_reactor_collapsed_total",
  "Projection subscriber jobs collapsed before enqueue",
  ["pipeline_name", "reactor_name"],
);
const subscriberTotal = counter("es_subscriber_total", "Eventing subscriber executions", [
  "pipeline_name",
  "subscriber_name",
  "status",
]);
const subscriberDuration = histogram(
  "es_subscriber_duration_milliseconds",
  "Eventing subscriber duration",
  ["pipeline_name", "subscriber_name"],
);
const subscriberEnqueueTotal = counter(
  "es_subscriber_enqueue_total",
  "Eventing subscriber routing outcomes",
  ["pipeline_name", "subscriber_name", "outcome"],
);

const foldRefoldTotal = counter("es_fold_refold_total", "Out-of-order fold replays", [
  "projection_name",
  "outcome",
]);
const foldRefoldOnMissTotal = counter(
  "es_fold_refold_on_miss_total",
  "Store-miss fold replays",
  ["projection_name", "outcome"],
);
const foldReadWindowFallbackTotal = counter(
  "es_fold_read_window_fallback_total",
  "Unwindowed retries after a fold read miss",
  ["projection_name", "outcome"],
);
const foldAbsentMissTrustedTotal = counter(
  "es_fold_absent_miss_trusted_total",
  "Authoritative absent fold reads",
  ["projection_name", "skipped"],
);
const foldCacheTotal = counter("es_fold_cache_total", "Fold consistency cache lookups", [
  "projection_name",
  "result",
]);
const foldCacheGetDuration = histogram(
  "es_fold_cache_get_duration_milliseconds",
  "Fold consistency cache reads",
  ["projection_name", "source"],
  [0.1, 0.5, 1, 2, 5, 10, 25, 50, 100, 250, 500],
);
const foldCacheStoreDuration = histogram(
  "es_fold_cache_store_duration_milliseconds",
  "Fold consistency cache writes",
  ["projection_name"],
  [0.1, 0.5, 1, 2, 5, 10, 25, 50, 100, 250, 500],
);
const foldCacheRedisErrorTotal = counter(
  "es_fold_cache_redis_error_total",
  "Fold consistency cache Redis failures",
  ["projection_name", "operation"],
);
const foldCacheEntryBytes = histogram(
  "es_fold_cache_entry_bytes",
  "Serialized fold consistency cache entry bytes",
  ["projection_name"],
  [1_024, 8_192, 65_536, 262_144, 1_048_576, 4_194_304, 16_777_216],
);
const foldDedupUnavailableTotal = counter(
  "es_fold_dedup_unavailable_total",
  "Retried folds without an applied-event set",
  ["projection_name", "reason"],
);
const foldDuplicateEventsSkippedTotal = counter(
  "es_fold_duplicate_events_skipped_total",
  "Redelivered fold events skipped",
  ["projection_name"],
);
const foldBlindReapplyEvents = histogram(
  "es_fold_blind_reapply_events",
  "Events blindly reapplied by a fold retry",
  ["projection_name"],
  [1, 2, 5, 10, 25, 50, 100, 250, 500],
);
const foldPostStoreFailureTotal = counter(
  "es_fold_post_store_failure_total",
  "Fold failures after durable state storage",
  ["projection_name", "stage"],
);

const processManagerTotal = counter(
  "es_process_manager_total",
  "Process-manager evolutions",
  ["process_name", "input_kind", "outcome"],
);
const processManagerDuration = histogram(
  "es_process_manager_duration_milliseconds",
  "Process-manager evolution duration",
  ["process_name", "input_kind"],
);
const processOutboxTotal = counter(
  "es_process_outbox_total",
  "Process-manager outbox attempts",
  ["process_name", "intent_type", "status"],
);
const processOutboxStuckDrains = counter(
  "es_process_outbox_stuck_drains_total",
  "Abandoned process-manager outbox drains",
  ["process_name"],
);
const processOutboxDuration = histogram(
  "es_process_outbox_duration_milliseconds",
  "Process-manager outbox attempt duration",
  ["process_name", "intent_type"],
  [1, 5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000, 30_000],
);
const processWakeLag = histogram(
  "es_process_wake_lag_milliseconds",
  "Process-manager wake delay",
  ["process_name"],
  [50, 250, 1_000, 5_000, 15_000, 60_000, 300_000, 900_000, 1_800_000, 3_600_000],
);
const processOutboxDispatchLag = histogram(
  "es_process_outbox_dispatch_lag_milliseconds",
  "Process-manager outbox dispatch delay",
  ["process_name"],
  [50, 250, 1_000, 5_000, 15_000, 60_000, 300_000, 900_000, 1_800_000, 3_600_000],
);
const processIntentsSuppressed = counter(
  "es_process_intents_suppressed_total",
  "Already-dispatched process-manager intents suppressed",
  ["process_name"],
);

export const incrementEsProjectionTotal = ({
  pipelineName,
  projectionKind,
  projectionName,
  status,
}: {
  pipelineName: string;
  projectionKind: "fold" | "map" | "state";
  projectionName: string;
  status: "completed" | "failed";
}) => projectionTotal.labels(pipelineName, projectionKind, projectionName, status).inc();
export const observeEsProjectionDuration = ({
  pipelineName,
  projectionKind,
  projectionName,
  durationMs,
}: {
  pipelineName: string;
  projectionKind: "fold" | "map" | "state";
  projectionName: string;
  durationMs: number;
}) =>
  projectionDuration
    .labels(pipelineName, projectionKind, projectionName)
    .observe(durationMs);
export const incrementEsCommandTotal = (
  pipelineName: string,
  commandType: string,
  status: "completed" | "failed",
) => commandTotal.labels(pipelineName, commandType, status).inc();
export const observeEsCommandDuration = (
  pipelineName: string,
  commandType: string,
  durationMs: number,
) => commandDuration.labels(pipelineName, commandType).observe(durationMs);
export const incrementEsFoldProjectionTotal = ({
  pipelineName,
  projectionName,
  status,
}: {
  pipelineName: string;
  projectionName: string;
  status: "completed" | "failed";
}) => {
  foldTotal.labels(pipelineName, projectionName, status).inc();
  incrementEsProjectionTotal({
    pipelineName,
    projectionKind: "fold",
    projectionName,
    status,
  });
};
export const observeEsFoldProjectionDuration = ({
  pipelineName,
  projectionName,
  durationMs,
}: {
  pipelineName: string;
  projectionName: string;
  durationMs: number;
}) => {
  foldDuration.labels(pipelineName, projectionName).observe(durationMs);
  observeEsProjectionDuration({
    pipelineName,
    projectionKind: "fold",
    projectionName,
    durationMs,
  });
};
export const incrementEsMapProjectionTotal = ({
  pipelineName,
  projectionName,
  status,
}: {
  pipelineName: string;
  projectionName: string;
  status: "completed" | "failed";
}) => {
  mapTotal.labels(pipelineName, projectionName, status).inc();
  incrementEsProjectionTotal({
    pipelineName,
    projectionKind: "map",
    projectionName,
    status,
  });
};
export const observeEsMapProjectionDuration = ({
  pipelineName,
  projectionName,
  durationMs,
}: {
  pipelineName: string;
  projectionName: string;
  durationMs: number;
}) => {
  mapDuration.labels(pipelineName, projectionName).observe(durationMs);
  observeEsProjectionDuration({
    pipelineName,
    projectionKind: "map",
    projectionName,
    durationMs,
  });
};
export const incrementEsMapProjectionEnqueueTotal = ({
  pipelineName,
  projectionName,
  outcome,
  count = 1,
}: {
  pipelineName: string;
  projectionName: string;
  outcome: "queued" | "filtered";
  count?: number;
}) => {
  if (count > 0) mapEnqueueTotal.labels(pipelineName, projectionName, outcome).inc(count);
};
export const incrementEsReactorTotal = (
  pipelineName: string,
  subscriberName: string,
  status: "completed" | "failed" | "skipped",
) => projectionSubscriberTotal.labels(pipelineName, subscriberName, status).inc();
export const observeEsReactorDuration = (
  pipelineName: string,
  subscriberName: string,
  durationMs: number,
) =>
  projectionSubscriberDuration.labels(pipelineName, subscriberName).observe(durationMs);
export const incrementEsReactorCollapsedTotal = (
  pipelineName: string,
  subscriberName: string,
  skipped: number,
) => projectionSubscriberCollapsed.labels(pipelineName, subscriberName).inc(skipped);
export const incrementEsSubscriberTotal = ({
  pipelineName,
  subscriberName,
  status,
}: {
  pipelineName: string;
  subscriberName: string;
  status: "completed" | "failed";
}) => subscriberTotal.labels(pipelineName, subscriberName, status).inc();
export const observeEsSubscriberDuration = ({
  pipelineName,
  subscriberName,
  durationMs,
}: {
  pipelineName: string;
  subscriberName: string;
  durationMs: number;
}) => subscriberDuration.labels(pipelineName, subscriberName).observe(durationMs);
export const incrementEsSubscriberEnqueueTotal = ({
  pipelineName,
  subscriberName,
  outcome,
}: {
  pipelineName: string;
  subscriberName: string;
  outcome: "filtered" | "staged" | "referenced" | "failed";
}) => subscriberEnqueueTotal.labels(pipelineName, subscriberName, outcome).inc();

export const incrementEsFoldRefoldTotal = (
  projectionName: string,
  outcome: "performed" | "declined" | "unavailable",
) => foldRefoldTotal.labels(projectionName, outcome).inc();
export const incrementEsFoldRefoldOnMissTotal = (
  projectionName: string,
  outcome: "performed" | "absent",
) => foldRefoldOnMissTotal.labels(projectionName, outcome).inc();
export const incrementEsFoldReadWindowFallbackTotal = (
  projectionName: string,
  outcome: "recovered" | "absent",
) => foldReadWindowFallbackTotal.labels(projectionName, outcome).inc();
export const incrementEsFoldAbsentMissTrustedTotal = (
  projectionName: string,
  skipped: "fallback_read" | "refold",
) => foldAbsentMissTrustedTotal.labels(projectionName, skipped).inc();
export const incrementEsFoldCacheTotal = (
  projectionName: string,
  result: "hit" | "miss" | "fallback_error",
) => foldCacheTotal.labels(projectionName, result).inc();
export const observeEsFoldCacheGetDuration = (
  projectionName: string,
  source: "redis" | "clickhouse",
  durationMs: number,
) => foldCacheGetDuration.labels(projectionName, source).observe(durationMs);
export const observeEsFoldCacheStoreDuration = (
  projectionName: string,
  durationMs: number,
) => foldCacheStoreDuration.labels(projectionName).observe(durationMs);
export const incrementEsFoldCacheRedisError = (
  projectionName: string,
  operation: "get" | "set" | "del",
) => foldCacheRedisErrorTotal.labels(projectionName, operation).inc();
export const observeEsFoldCacheEntryBytes = (projectionName: string, bytes: number) =>
  foldCacheEntryBytes.labels(projectionName).observe(bytes);
export const incrementEsFoldDedupUnavailable = (
  projectionName: string,
  reason: "cache_miss" | "read_error" | "unreadable" | "legacy_entry",
) => foldDedupUnavailableTotal.labels(projectionName, reason).inc();
export const incrementEsFoldDuplicateEventsSkipped = (
  projectionName: string,
  count = 1,
) => foldDuplicateEventsSkippedTotal.labels(projectionName).inc(count);
export const observeEsFoldBlindReapplyEvents = (projectionName: string, events: number) =>
  foldBlindReapplyEvents.labels(projectionName).observe(events);
export const incrementEsFoldPostStoreFailure = ({
  projectionName,
  stage,
}: {
  projectionName: string;
  stage: "reactor_dispatch";
}) => foldPostStoreFailureTotal.labels(projectionName, stage).inc();

export const incrementEsProcessManagerTotal = ({
  processName,
  inputKind,
  outcome,
}: {
  processName: string;
  inputKind: "event" | "wake" | "signal";
  outcome:
    | "committed"
    | "duplicate_event"
    | "duplicate_signal"
    | "process_not_found"
    | "stale_wake"
    | "revision_conflict"
    | "failed";
}) => processManagerTotal.labels(processName, inputKind, outcome).inc();
export const observeEsProcessManagerDuration = ({
  processName,
  inputKind,
  durationMs,
}: {
  processName: string;
  inputKind: "event" | "wake" | "signal";
  durationMs: number;
}) => processManagerDuration.labels(processName, inputKind).observe(durationMs);
export const incrementEsProcessOutboxTotal = ({
  processName,
  intentType,
  status,
}: {
  processName: string;
  intentType: string;
  status: "dispatched" | "retried" | "dead" | "fenced" | "released";
}) => processOutboxTotal.labels(processName, intentType, status).inc();
export const incrementEsProcessOutboxStuckDrains = ({
  processName,
}: {
  processName: string;
}) => processOutboxStuckDrains.labels(processName).inc();
export const observeEsProcessOutboxDuration = ({
  processName,
  intentType,
  durationMs,
}: {
  processName: string;
  intentType: string;
  durationMs: number;
}) => processOutboxDuration.labels(processName, intentType).observe(durationMs);
export const observeEsProcessWakeLag = ({
  processName,
  lagMs,
}: {
  processName: string;
  lagMs: number;
}) => processWakeLag.labels(processName).observe(Math.max(0, lagMs));
export const observeEsProcessOutboxDispatchLag = ({
  processName,
  lagMs,
}: {
  processName: string;
  lagMs: number;
}) => processOutboxDispatchLag.labels(processName).observe(Math.max(0, lagMs));
export const incrementEsProcessIntentsSuppressed = ({
  processName,
  count,
}: {
  processName: string;
  count: number;
}) => processIntentsSuppressed.labels(processName).inc(count);

export async function withMetrics<T>({
  fn,
  onComplete,
  onFail,
}: {
  fn: () => Promise<T>;
  onComplete: (durationMs: number) => void;
  onFail: (durationMs: number) => void;
}): Promise<T> {
  const start = performance.now();
  try {
    const result = await fn();
    onComplete(performance.now() - start);
    return result;
  } catch (error) {
    onFail(performance.now() - start);
    throw error;
  }
}
