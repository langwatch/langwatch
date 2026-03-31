import type { Command, CommandHandler } from "../../../";
import {
  createTenantId,
  defineCommandSchema,
  EventUtils,
} from "../../../";
import { createLogger } from "../../../../../utils/logger/server";
import type { BulkSyncAnnotationsCommandData } from "../schemas/commands";
import { bulkSyncAnnotationsCommandDataSchema } from "../schemas/commands";
import {
  ANNOTATIONS_BULK_SYNCED_EVENT_TYPE,
  ANNOTATIONS_BULK_SYNCED_EVENT_VERSION_LATEST,
  BULK_SYNC_ANNOTATIONS_COMMAND_TYPE,
} from "../schemas/constants";
import type { AnnotationsBulkSyncedEvent } from "../schemas/events";

const logger = createLogger(
  "langwatch:trace-processing:bulk-sync-annotations",
);

/**
 * Command handler for bulk-syncing annotations to a trace.
 *
 * Emits an AnnotationsBulkSyncedEvent that replaces the entire annotationIds
 * array on the trace summary. Used for one-time migration from Prisma.
 */
export class BulkSyncAnnotationsCommand
  implements
    CommandHandler<
      Command<BulkSyncAnnotationsCommandData>,
      AnnotationsBulkSyncedEvent
    >
{
  static readonly schema = defineCommandSchema(
    BULK_SYNC_ANNOTATIONS_COMMAND_TYPE,
    bulkSyncAnnotationsCommandDataSchema,
    "Command to bulk-sync all annotation IDs for a trace in the trace processing pipeline",
  );

  handle(
    command: Command<BulkSyncAnnotationsCommandData>,
  ): AnnotationsBulkSyncedEvent[] {
    const { tenantId: tenantIdStr, data } = command;
    const tenantId = createTenantId(tenantIdStr);

    logger.debug(
      {
        tenantId,
        traceId: data.traceId,
        annotationCount: data.annotationIds.length,
      },
      "Handling bulk sync annotations command",
    );

    const event = EventUtils.createEvent<AnnotationsBulkSyncedEvent>({
      aggregateType: "trace",
      aggregateId: data.traceId,
      tenantId,
      type: ANNOTATIONS_BULK_SYNCED_EVENT_TYPE,
      version: ANNOTATIONS_BULK_SYNCED_EVENT_VERSION_LATEST,
      data: {
        annotationIds: data.annotationIds,
      },
      occurredAt: data.occurredAt,
    });

    logger.debug(
      {
        tenantId,
        traceId: data.traceId,
        eventId: event.id,
        eventType: event.type,
      },
      "Emitting AnnotationsBulkSyncedEvent",
    );

    return [event];
  }

  static getAggregateId(payload: BulkSyncAnnotationsCommandData): string {
    return payload.traceId;
  }

  static getSpanAttributes(
    payload: BulkSyncAnnotationsCommandData,
  ): Record<string, string | number | boolean> {
    return {
      "payload.trace.id": payload.traceId,
      "payload.annotation.count": payload.annotationIds.length,
    };
  }

  static makeJobId(payload: BulkSyncAnnotationsCommandData): string {
    return `${payload.tenantId}:${payload.traceId}:bulk_sync_annotations`;
  }
}
