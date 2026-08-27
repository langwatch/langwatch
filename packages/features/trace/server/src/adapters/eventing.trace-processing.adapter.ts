import { defineCommand } from "@langwatch/eventing";
import {
  ADD_ANNOTATION_COMMAND_TYPE,
  ANNOTATION_ADDED_EVENT_TYPE,
  ANNOTATION_ADDED_EVENT_VERSION_LATEST,
  ANNOTATION_REMOVED_EVENT_TYPE,
  ANNOTATION_REMOVED_EVENT_VERSION_LATEST,
  ANNOTATIONS_BULK_SYNCED_EVENT_TYPE,
  ANNOTATIONS_BULK_SYNCED_EVENT_VERSION_LATEST,
  BULK_SYNC_ANNOTATIONS_COMMAND_TYPE,
  REMOVE_ANNOTATION_COMMAND_TYPE,
} from "@langwatch/trace-contract";
import {
  annotationAddedEventDataSchema,
  annotationRemovedEventDataSchema,
  annotationsBulkSyncedEventDataSchema,
} from "@langwatch/trace-contract";
import { recordLogContributionCommand } from "./eventing.trace-log-contribution.adapter";
import { recordMetricCorrelationCommand } from "./eventing.trace-metric-correlation.adapter";
import { changeTraceNameCommand } from "./eventing.change-trace-name.command";

const addAnnotationCommand = defineCommand({
  commandType: ADD_ANNOTATION_COMMAND_TYPE,
  eventType: ANNOTATION_ADDED_EVENT_TYPE,
  eventVersion: ANNOTATION_ADDED_EVENT_VERSION_LATEST,
  aggregateType: "trace",
  schema: annotationAddedEventDataSchema,
  aggregateId: (d) => d.traceId,
  idempotencyKey: (d) => `${d.tenantId}:${d.traceId}:add_annotation:${d.annotationId}`,
  spanAttributes: (d) => ({
    "payload.trace.id": d.traceId,
    "payload.annotation.id": d.annotationId,
  }),
  makeJobId: (d) => `${d.tenantId}:${d.traceId}:add_annotation:${d.annotationId}`,
});

const removeAnnotationCommand = defineCommand({
  commandType: REMOVE_ANNOTATION_COMMAND_TYPE,
  eventType: ANNOTATION_REMOVED_EVENT_TYPE,
  eventVersion: ANNOTATION_REMOVED_EVENT_VERSION_LATEST,
  aggregateType: "trace",
  schema: annotationRemovedEventDataSchema,
  aggregateId: (d) => d.traceId,
  idempotencyKey: (d) => `${d.tenantId}:${d.traceId}:remove_annotation:${d.annotationId}`,
  spanAttributes: (d) => ({
    "payload.trace.id": d.traceId,
    "payload.annotation.id": d.annotationId,
  }),
  makeJobId: (d) => `${d.tenantId}:${d.traceId}:remove_annotation:${d.annotationId}`,
});

const bulkSyncAnnotationsCommand = defineCommand({
  commandType: BULK_SYNC_ANNOTATIONS_COMMAND_TYPE,
  eventType: ANNOTATIONS_BULK_SYNCED_EVENT_TYPE,
  eventVersion: ANNOTATIONS_BULK_SYNCED_EVENT_VERSION_LATEST,
  aggregateType: "trace",
  schema: annotationsBulkSyncedEventDataSchema,
  aggregateId: (d) => d.traceId,
  idempotencyKey: (d) => `${d.tenantId}:${d.traceId}:bulk_sync_annotations`,
  spanAttributes: (d) => ({
    "payload.trace.id": d.traceId,
    "payload.annotation.count": d.annotationIds.length,
  }),
  makeJobId: (d) => `${d.tenantId}:${d.traceId}:bulk_sync_annotations`,
});

/** Eventing command definitions owned by the Trace aggregate. */
export class EventingTraceProcessingAdapter {
  private constructor() {}

  static create(): EventingTraceProcessingAdapter {
    return new EventingTraceProcessingAdapter();
  }

  readonly addAnnotationCommand = addAnnotationCommand;
  readonly removeAnnotationCommand = removeAnnotationCommand;
  readonly bulkSyncAnnotationsCommand = bulkSyncAnnotationsCommand;
  readonly recordLogContributionCommand = recordLogContributionCommand;
  readonly recordMetricCorrelationCommand = recordMetricCorrelationCommand;
  readonly changeTraceNameCommand = changeTraceNameCommand;
}
