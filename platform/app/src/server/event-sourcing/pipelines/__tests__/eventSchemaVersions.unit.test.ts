import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { TRIGGER_MATCH_RECORDED_EVENT_VERSION_LATEST } from "../automations/schemas/constants";
import { triggerMatchRecordedEventSchema } from "../automations/schemas/events";
import {
  LOG_FACTS_CONTRIBUTED_EVENT_VERSION_LATEST,
  METRIC_FACTS_CONTRIBUTED_EVENT_VERSION_LATEST,
  SPAN_FACTS_CONTRIBUTED_EVENT_VERSION_LATEST,
} from "../coding-agent-processing/schemas/constants";
import {
  logFactsContributedEventSchema,
  metricFactsContributedEventSchema,
  spanFactsContributedEventSchema,
} from "../coding-agent-processing/schemas/events";
import { EVALUATION_EVENT_VERSIONS } from "../evaluation-processing/schemas/constants";
import {
  evaluationCompletedEventSchema,
  evaluationReportedEventSchema,
  evaluationScheduledEventSchema,
  evaluationStartedEventSchema,
} from "../evaluation-processing/schemas/events";
import { EXPERIMENT_RUN_EVENT_VERSIONS } from "../experiment-run-processing/schemas/constants";
import {
  evaluatorResultEventSchema,
  experimentRunCompletedEventSchema,
  experimentRunStartedEventSchema,
  targetResultEventSchema,
} from "../experiment-run-processing/schemas/events";
import { CANONICAL_LOG_RECORD_RECEIVED_EVENT_VERSION_LATEST } from "../log-processing/schemas/constants";
import { canonicalLogRecordReceivedEventSchema } from "../log-processing/schemas/events";
import { METRIC_DATA_POINT_RECEIVED_EVENT_VERSION_LATEST } from "../metric-processing/schemas/constants";
import { metricDataPointReceivedEventSchema } from "../metric-processing/schemas/events";
import {
  ANNOTATION_ADDED_EVENT_VERSIONS,
  ANNOTATION_REMOVED_EVENT_VERSIONS,
  ANNOTATIONS_BULK_SYNCED_EVENT_VERSIONS,
  LOG_CONTRIBUTED_EVENT_VERSIONS,
  LOG_RECORD_RECEIVED_EVENT_VERSIONS,
  METRIC_DATA_POINT_CORRELATED_EVENT_VERSIONS,
  ORIGIN_RESOLVED_EVENT_VERSIONS,
  SPAN_RECEIVED_EVENT_VERSIONS,
  TOPIC_ASSIGNED_EVENT_VERSIONS,
  TRACE_NAME_CHANGED_EVENT_VERSIONS,
} from "../trace-processing/schemas/constants";
import {
  annotationAddedEventSchema,
  annotationRemovedEventSchema,
  annotationsBulkSyncedEventSchema,
  logContributedEventSchema,
  logRecordReceivedEventSchema,
  metricDataPointCorrelatedEventSchema,
  originResolvedEventSchema,
  spanReceivedEventSchema,
  topicAssignedEventSchema,
  traceNameChangedEventSchema,
} from "../trace-processing/schemas/events";

/**
 * Every durable event schema in these pipelines, paired with the complete set
 * of versions its type has ever been minted at.
 *
 * What this table exists to catch is a schema that never overrode `version` at
 * all. The base `EventSchema` types it as `z.string().date()`, which accepts
 * any date-shaped string — so such a schema silently constrains the mint site
 * to nothing, and a payload written under a different version type-checks as if
 * it were the current shape. The single test below feeds every schema a
 * date-shaped version no pipeline has ever minted; only a schema that inherited
 * the loose base accepts it.
 *
 * It deliberately does NOT assert that each schema accepts its own versions:
 * every schema here builds `version` from the very constant this table pairs it
 * with (`z.literal(X_VERSION_LATEST)`, `z.enum(X_EVENT_VERSIONS)`), so such an
 * assertion would echo a value back at itself and could not fail.
 *
 * The versions column is the pipeline's own constant rather than dates repeated
 * here, so the "never minted" probe stays honest as pipelines add versions.
 */
const eventSchemas: ReadonlyArray<
  readonly [string, z.ZodObject<{ version: z.ZodTypeAny }>, readonly string[]]
> = [
  [
    "automations/trigger_match_recorded",
    triggerMatchRecordedEventSchema,
    [TRIGGER_MATCH_RECORDED_EVENT_VERSION_LATEST],
  ],
  [
    "coding-agent/span_facts_contributed",
    spanFactsContributedEventSchema,
    [SPAN_FACTS_CONTRIBUTED_EVENT_VERSION_LATEST],
  ],
  [
    "coding-agent/log_facts_contributed",
    logFactsContributedEventSchema,
    [LOG_FACTS_CONTRIBUTED_EVENT_VERSION_LATEST],
  ],
  [
    "coding-agent/metric_facts_contributed",
    metricFactsContributedEventSchema,
    [METRIC_FACTS_CONTRIBUTED_EVENT_VERSION_LATEST],
  ],
  [
    "evaluation/scheduled",
    evaluationScheduledEventSchema,
    [EVALUATION_EVENT_VERSIONS.SCHEDULED],
  ],
  [
    "evaluation/started",
    evaluationStartedEventSchema,
    [EVALUATION_EVENT_VERSIONS.STARTED],
  ],
  [
    "evaluation/completed",
    evaluationCompletedEventSchema,
    [EVALUATION_EVENT_VERSIONS.COMPLETED],
  ],
  [
    "evaluation/reported",
    evaluationReportedEventSchema,
    [EVALUATION_EVENT_VERSIONS.REPORTED],
  ],
  [
    "experiment-run/started",
    experimentRunStartedEventSchema,
    [EXPERIMENT_RUN_EVENT_VERSIONS.STARTED],
  ],
  [
    "experiment-run/target_result",
    targetResultEventSchema,
    [EXPERIMENT_RUN_EVENT_VERSIONS.TARGET_RESULT],
  ],
  [
    "experiment-run/evaluator_result",
    evaluatorResultEventSchema,
    [EXPERIMENT_RUN_EVENT_VERSIONS.EVALUATOR_RESULT],
  ],
  [
    "experiment-run/completed",
    experimentRunCompletedEventSchema,
    [EXPERIMENT_RUN_EVENT_VERSIONS.COMPLETED],
  ],
  [
    "log/record_received",
    canonicalLogRecordReceivedEventSchema,
    [CANONICAL_LOG_RECORD_RECEIVED_EVENT_VERSION_LATEST],
  ],
  [
    "metric/data_point_received",
    metricDataPointReceivedEventSchema,
    [METRIC_DATA_POINT_RECEIVED_EVENT_VERSION_LATEST],
  ],
  [
    "trace/span_received",
    spanReceivedEventSchema,
    SPAN_RECEIVED_EVENT_VERSIONS,
  ],
  [
    "trace/topic_assigned",
    topicAssignedEventSchema,
    TOPIC_ASSIGNED_EVENT_VERSIONS,
  ],
  [
    "trace/log_record_received",
    logRecordReceivedEventSchema,
    LOG_RECORD_RECEIVED_EVENT_VERSIONS,
  ],
  [
    "trace/log_contributed",
    logContributedEventSchema,
    LOG_CONTRIBUTED_EVENT_VERSIONS,
  ],
  [
    "trace/metric_data_point_correlated",
    metricDataPointCorrelatedEventSchema,
    METRIC_DATA_POINT_CORRELATED_EVENT_VERSIONS,
  ],
  [
    "trace/origin_resolved",
    originResolvedEventSchema,
    ORIGIN_RESOLVED_EVENT_VERSIONS,
  ],
  [
    "trace/annotation_added",
    annotationAddedEventSchema,
    ANNOTATION_ADDED_EVENT_VERSIONS,
  ],
  [
    "trace/annotation_removed",
    annotationRemovedEventSchema,
    ANNOTATION_REMOVED_EVENT_VERSIONS,
  ],
  [
    "trace/annotations_bulk_synced",
    annotationsBulkSyncedEventSchema,
    ANNOTATIONS_BULK_SYNCED_EVENT_VERSIONS,
  ],
  [
    "trace/trace_name_changed",
    traceNameChangedEventSchema,
    TRACE_NAME_CHANGED_EVENT_VERSIONS,
  ],
];

describe("durable event schemas", () => {
  describe("given a date-shaped version the pipeline has never minted", () => {
    it.each(eventSchemas)("rejects it on %s", (_name, schema, versions) => {
      // Date-shaped on purpose: this is precisely what the base
      // `z.string().date()` accepted, so a schema that still passes this has no
      // version assertion of its own.
      const foreign = "2099-01-01";
      expect(versions).not.toContain(foreign);

      expect(schema.shape.version.safeParse(foreign).success).toBe(false);
    });
  });
});
