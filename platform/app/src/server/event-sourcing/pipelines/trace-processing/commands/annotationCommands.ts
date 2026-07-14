import { defineCommand } from "../../../commands/defineCommand";
import {
  annotationAddedEventDataSchema,
  annotationRemovedEventDataSchema,
  annotationsBulkSyncedEventDataSchema,
} from "../schemas/events";
import {
  ADD_ANNOTATION_COMMAND_TYPE,
  ANNOTATION_ADDED_EVENT_TYPE,
  ANNOTATION_ADDED_EVENT_VERSION_LATEST,
  REMOVE_ANNOTATION_COMMAND_TYPE,
  ANNOTATION_REMOVED_EVENT_TYPE,
  ANNOTATION_REMOVED_EVENT_VERSION_LATEST,
  BULK_SYNC_ANNOTATIONS_COMMAND_TYPE,
  ANNOTATIONS_BULK_SYNCED_EVENT_TYPE,
  ANNOTATIONS_BULK_SYNCED_EVENT_VERSION_LATEST,
} from "../schemas/constants";

export const AddAnnotationCommand = defineCommand({
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

export const RemoveAnnotationCommand = defineCommand({
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

export const BulkSyncAnnotationsCommand = defineCommand({
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
