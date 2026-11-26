import type { UsageCategory } from "@langwatch/entitlement-contract";
import { EVALUATION_EVENT_TYPES } from "@langwatch/evaluation-contract";
import { CANONICAL_LOG_RECORD_RECEIVED_EVENT_TYPE } from "@langwatch/log-contract";
import {
  canonicalMetricDataPointSchema,
  METRIC_DATA_POINT_RECEIVED_EVENT_TYPE,
} from "@langwatch/metric-contract";
import { SIMULATION_RUN_EVENT_TYPES } from "@langwatch/scenario-contract";
import { Temporal } from "@langwatch/time";
import { SPAN_RECEIVED_EVENT_TYPE } from "@langwatch/trace-contract";

/**
 * Experiment-run event types as literals: their constant lives in experiment's process
 * half, which a module may not import. Wire values, so they never change without a migration.
 */
const EXPERIMENT_RUN_STARTED_EVENT_TYPE = "lw.experiment_run.started";
const EXPERIMENT_RUN_EVALUATOR_RESULT_EVENT_TYPE = "lw.experiment_run.evaluator_result";
const EXPERIMENT_RUN_TARGET_RESULT_EVENT_TYPE = "lw.experiment_run.target_result";

const CATEGORY_BY_EVENT_TYPE: ReadonlyMap<string, UsageCategory> = new Map<string, UsageCategory>([
  [SPAN_RECEIVED_EVENT_TYPE, "spans"],
  [CANONICAL_LOG_RECORD_RECEIVED_EVENT_TYPE, "logs"],
  [METRIC_DATA_POINT_RECEIVED_EVENT_TYPE, "metrics"],
  [EVALUATION_EVENT_TYPES.REPORTED, "evaluations"],
  [EXPERIMENT_RUN_STARTED_EVENT_TYPE, "experiments"],
  [EXPERIMENT_RUN_EVALUATOR_RESULT_EVENT_TYPE, "experiments"],
  [EXPERIMENT_RUN_TARGET_RESULT_EVENT_TYPE, "experiments"],
  [SIMULATION_RUN_EVENT_TYPES.STARTED, "scenarios"],
  [SIMULATION_RUN_EVENT_TYPES.MESSAGE_SNAPSHOT, "scenarios"],
]);

/** Every event type the meter bills, in the order the docs list them. */
export const BILLABLE_EVENT_TYPES: readonly string[] = [...CATEGORY_BY_EVENT_TYPE.keys()];

/** A type the meter does not bill has no usage-page kind. */
export const NOT_BILLED = "not_billed" as const;

/** The usage-page kind of a billed event type, or `NOT_BILLED`. */
export function categoryOfBillableEventType(eventType: string): UsageCategory | typeof NOT_BILLED {
  return CATEGORY_BY_EVENT_TYPE.get(eventType) ?? NOT_BILLED;
}

const metricSeriesSchema = canonicalMetricDataPointSchema.pick({ seriesId: true });

/** A metric point's series-hour key, or why it has none. */
type MetricSeriesHourKey =
  | Readonly<{ outcome: "keyed"; key: string }>
  | Readonly<{ outcome: "no_series_id" }>;

/**
 * A metric data point's meter key: one per series per UTC clock hour of receipt, so a series
 * bills once an hour however many points it sends. Data without a valid series id answers
 * `no_series_id`, so the caller falls back to the event's own key instead of throwing.
 */
export function metricSeriesHourKey({
  tenantId,
  data,
  receivedAtMs,
}: {
  tenantId: string;
  data: unknown;
  receivedAtMs: number;
}): MetricSeriesHourKey {
  const parsed = metricSeriesSchema.safeParse(data);
  if (!parsed.success) return { outcome: "no_series_id" };
  const hour = Temporal.Instant.fromEpochMilliseconds(receivedAtMs).toString().slice(0, 13);
  return { outcome: "keyed", key: `${tenantId}:${parsed.data.seriesId}:${hour}` };
}
