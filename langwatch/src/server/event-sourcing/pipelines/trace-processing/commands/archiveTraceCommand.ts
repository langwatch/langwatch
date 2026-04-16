import type { Command, CommandHandler } from "../../../";
import {
  createTenantId,
  defineCommandSchema,
  EventUtils,
} from "../../../";
import { createLogger } from "../../../../../utils/logger/server";
import type { ArchiveTraceCommandData } from "../schemas/commands";
import { archiveTraceCommandDataSchema } from "../schemas/commands";
import {
  ARCHIVE_TRACE_COMMAND_TYPE,
  TRACE_ARCHIVED_EVENT_TYPE,
  TRACE_ARCHIVED_EVENT_VERSION_LATEST,
} from "../schemas/constants";
import type { TraceArchivedEvent } from "../schemas/events";

const logger = createLogger(
  "langwatch:trace-processing:archive-trace",
);

/**
 * Command handler for archiving a trace.
 *
 * Emits a TraceArchivedEvent that marks the trace as archived.
 * The trace data is not deleted — it is simply excluded from
 * future query results via the ArchivedAt column.
 */
export class ArchiveTraceCommand
  implements
    CommandHandler<
      Command<ArchiveTraceCommandData>,
      TraceArchivedEvent
    >
{
  static readonly schema = defineCommandSchema(
    ARCHIVE_TRACE_COMMAND_TYPE,
    archiveTraceCommandDataSchema,
    "Command to archive a trace (soft delete)",
  );

  handle(
    command: Command<ArchiveTraceCommandData>,
  ): TraceArchivedEvent[] {
    const { tenantId: tenantIdStr, data } = command;
    const tenantId = createTenantId(tenantIdStr);
    const archivedAtMs = Date.now();

    logger.debug(
      {
        tenantId,
        traceId: data.traceId,
      },
      "Handling archive trace command",
    );

    const event = EventUtils.createEvent<TraceArchivedEvent>({
      aggregateType: "trace",
      aggregateId: data.traceId,
      tenantId,
      type: TRACE_ARCHIVED_EVENT_TYPE,
      version: TRACE_ARCHIVED_EVENT_VERSION_LATEST,
      data: {
        traceId: data.traceId,
        archivedAtMs,
      },
      occurredAt: data.occurredAt,
      idempotencyKey: `archive-trace:${tenantIdStr}:${data.traceId}`,
    });

    logger.debug(
      {
        tenantId,
        traceId: data.traceId,
        eventId: event.id,
        eventType: event.type,
      },
      "Emitting TraceArchivedEvent",
    );

    return [event];
  }

  static getAggregateId(payload: ArchiveTraceCommandData): string {
    return payload.traceId;
  }

  static getSpanAttributes(
    payload: ArchiveTraceCommandData,
  ): Record<string, string | number | boolean> {
    return {
      "payload.trace.id": payload.traceId,
    };
  }

  static makeJobId(payload: ArchiveTraceCommandData): string {
    return `${payload.tenantId}:${payload.traceId}:archive-trace`;
  }
}
