import type { Command, CommandHandler } from "../../../";
import {
  createTenantId,
  defineCommandSchema,
  EventUtils,
} from "../../../";
import { createLogger } from "../../../../../utils/logger/server";
import type { ResolveOriginCommandData } from "../schemas/commands";
import { resolveOriginCommandDataSchema } from "../schemas/commands";
import {
  ORIGIN_RESOLVED_EVENT_TYPE,
  ORIGIN_RESOLVED_EVENT_VERSION_LATEST,
  RESOLVE_ORIGIN_COMMAND_TYPE,
} from "../schemas/constants";
import type { OriginResolvedEvent } from "../schemas/events";

const logger = createLogger(
  "langwatch:trace-processing:resolve-origin",
);

/**
 * Command handler for resolving the origin of a trace.
 *
 * Emits an OriginResolvedEvent when origin is inferred (not explicitly set
 * by the SDK). This persists the inferred origin through the event-sourcing
 * pipeline so it reaches ClickHouse via the fold projection.
 */
export class ResolveOriginCommand
  implements
    CommandHandler<
      Command<ResolveOriginCommandData>,
      OriginResolvedEvent
    >
{
  static readonly schema = defineCommandSchema(
    RESOLVE_ORIGIN_COMMAND_TYPE,
    resolveOriginCommandDataSchema,
    "Command to resolve the origin of a trace when not explicitly set",
  );

  handle(
    command: Command<ResolveOriginCommandData>,
  ): OriginResolvedEvent[] {
    const { tenantId: tenantIdStr, data } = command;
    const tenantId = createTenantId(tenantIdStr);

    logger.debug(
      {
        tenantId,
        traceId: data.traceId,
        origin: data.origin,
        reason: data.reason,
      },
      "Handling resolve origin command",
    );

    const event = EventUtils.createEvent<OriginResolvedEvent>({
      aggregateType: "trace",
      aggregateId: data.traceId,
      tenantId,
      type: ORIGIN_RESOLVED_EVENT_TYPE,
      version: ORIGIN_RESOLVED_EVENT_VERSION_LATEST,
      data: {
        origin: data.origin,
        reason: data.reason,
      },
      occurredAt: data.occurredAt,
      idempotencyKey: `resolve-origin:${tenantIdStr}:${data.traceId}`,
    });

    logger.debug(
      {
        tenantId,
        traceId: data.traceId,
        eventId: event.id,
        eventType: event.type,
      },
      "Emitting OriginResolvedEvent",
    );

    return [event];
  }

  static getAggregateId(payload: ResolveOriginCommandData): string {
    return payload.traceId;
  }

  static getSpanAttributes(
    payload: ResolveOriginCommandData,
  ): Record<string, string | number | boolean> {
    return {
      "payload.trace.id": payload.traceId,
      "payload.origin": payload.origin,
      "payload.reason": payload.reason,
    };
  }

  static makeJobId(payload: ResolveOriginCommandData): string {
    return `${payload.tenantId}:${payload.traceId}:resolve-origin`;
  }
}
