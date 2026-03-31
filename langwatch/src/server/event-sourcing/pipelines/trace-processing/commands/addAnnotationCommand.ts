import type { Command, CommandHandler } from "../../../";
import {
  createTenantId,
  defineCommandSchema,
  EventUtils,
} from "../../../";
import { createLogger } from "../../../../../utils/logger/server";
import type { AddAnnotationCommandData } from "../schemas/commands";
import { addAnnotationCommandDataSchema } from "../schemas/commands";
import {
  ADD_ANNOTATION_COMMAND_TYPE,
  ANNOTATION_ADDED_EVENT_TYPE,
  ANNOTATION_ADDED_EVENT_VERSION_LATEST,
} from "../schemas/constants";
import type { AnnotationAddedEvent } from "../schemas/events";

const logger = createLogger(
  "langwatch:trace-processing:add-annotation",
);

/**
 * Command handler for adding an annotation to a trace.
 *
 * Emits an AnnotationAddedEvent that the fold projection uses to append
 * the annotation ID to the trace summary's annotationIds array.
 */
export class AddAnnotationCommand
  implements
    CommandHandler<
      Command<AddAnnotationCommandData>,
      AnnotationAddedEvent
    >
{
  static readonly schema = defineCommandSchema(
    ADD_ANNOTATION_COMMAND_TYPE,
    addAnnotationCommandDataSchema,
    "Command to add an annotation to a trace in the trace processing pipeline",
  );

  handle(
    command: Command<AddAnnotationCommandData>,
  ): AnnotationAddedEvent[] {
    const { tenantId: tenantIdStr, data } = command;
    const tenantId = createTenantId(tenantIdStr);

    logger.debug(
      {
        tenantId,
        traceId: data.traceId,
        annotationId: data.annotationId,
      },
      "Handling add annotation command",
    );

    const event = EventUtils.createEvent<AnnotationAddedEvent>({
      aggregateType: "trace",
      aggregateId: data.traceId,
      tenantId,
      type: ANNOTATION_ADDED_EVENT_TYPE,
      version: ANNOTATION_ADDED_EVENT_VERSION_LATEST,
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
      "Emitting AnnotationAddedEvent",
    );

    return [event];
  }

  static getAggregateId(payload: AddAnnotationCommandData): string {
    return payload.traceId;
  }

  static getSpanAttributes(
    payload: AddAnnotationCommandData,
  ): Record<string, string | number | boolean> {
    return {
      "payload.trace.id": payload.traceId,
      "payload.annotation.id": payload.annotationId,
    };
  }

  static makeJobId(payload: AddAnnotationCommandData): string {
    return `${payload.tenantId}:${payload.traceId}:add_annotation:${payload.annotationId}`;
  }
}
