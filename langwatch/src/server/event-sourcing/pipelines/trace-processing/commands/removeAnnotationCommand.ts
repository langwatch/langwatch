import type { Command, CommandHandler } from "../../../";
import {
  createTenantId,
  defineCommandSchema,
  EventUtils,
} from "../../../";
import { createLogger } from "../../../../../utils/logger/server";
import type { RemoveAnnotationCommandData } from "../schemas/commands";
import { removeAnnotationCommandDataSchema } from "../schemas/commands";
import {
  ANNOTATION_REMOVED_EVENT_TYPE,
  ANNOTATION_REMOVED_EVENT_VERSION_LATEST,
  REMOVE_ANNOTATION_COMMAND_TYPE,
} from "../schemas/constants";
import type { AnnotationRemovedEvent } from "../schemas/events";

const logger = createLogger(
  "langwatch:trace-processing:remove-annotation",
);

/**
 * Command handler for removing an annotation from a trace.
 *
 * Emits an AnnotationRemovedEvent that the fold projection uses to filter
 * the annotation ID from the trace summary's annotationIds array.
 */
export class RemoveAnnotationCommand
  implements
    CommandHandler<
      Command<RemoveAnnotationCommandData>,
      AnnotationRemovedEvent
    >
{
  static readonly schema = defineCommandSchema(
    REMOVE_ANNOTATION_COMMAND_TYPE,
    removeAnnotationCommandDataSchema,
    "Command to remove an annotation from a trace in the trace processing pipeline",
  );

  handle(
    command: Command<RemoveAnnotationCommandData>,
  ): AnnotationRemovedEvent[] {
    const { tenantId: tenantIdStr, data } = command;
    const tenantId = createTenantId(tenantIdStr);

    logger.debug(
      {
        tenantId,
        traceId: data.traceId,
        annotationId: data.annotationId,
      },
      "Handling remove annotation command",
    );

    const event = EventUtils.createEvent<AnnotationRemovedEvent>({
      aggregateType: "trace",
      aggregateId: data.traceId,
      tenantId,
      type: ANNOTATION_REMOVED_EVENT_TYPE,
      version: ANNOTATION_REMOVED_EVENT_VERSION_LATEST,
      data: {
        annotationId: data.annotationId,
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
      "Emitting AnnotationRemovedEvent",
    );

    return [event];
  }

  static getAggregateId(payload: RemoveAnnotationCommandData): string {
    return payload.traceId;
  }

  static getSpanAttributes(
    payload: RemoveAnnotationCommandData,
  ): Record<string, string | number | boolean> {
    return {
      "payload.trace.id": payload.traceId,
      "payload.annotation.id": payload.annotationId,
    };
  }

  static makeJobId(payload: RemoveAnnotationCommandData): string {
    return `${payload.tenantId}:${payload.traceId}:remove_annotation:${payload.annotationId}`;
  }
}
