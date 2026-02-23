import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import type { Event, EventStoreReadContext } from "../";
import { createLogger } from "../../../utils/logger/server";
import { AbstractEventStore } from "./abstractEventStore";
import type { EventRepository } from "./repositories/eventRepository.types";

/**
 * ClickHouse-backed EventStore with OpenTelemetry instrumentation and structured logging.
 *
 * Extends {@link AbstractEventStore} with:
 * - `instrument()`: wraps operations in OpenTelemetry spans
 * - `logError()`: structured error logging via pino
 * - `onStoreSuccess()`: logs successful writes with tenant/count details
 */
export class EventStoreClickHouse<
  EventType extends Event = Event,
> extends AbstractEventStore<EventType> {
  private readonly tracer = getLangWatchTracer(
    "langwatch.trace-processing.event-store.clickhouse",
  );
  private readonly logger = createLogger(
    "langwatch:trace-processing:event-store:clickhouse",
  );

  constructor(repository: EventRepository) {
    super(repository);
  }

  protected override async instrument<T>(
    name: string,
    attributes: Record<string, string | number>,
    fn: () => Promise<T>,
  ): Promise<T> {
    return await this.tracer.withActiveSpan(
      name,
      { kind: SpanKind.INTERNAL, attributes },
      async () => fn(),
    );
  }

  protected override logError(
    name: string,
    context: Record<string, unknown>,
    error: unknown,
  ): void {
    this.logger.error(
      {
        ...context,
        error,
      },
      `Failed: ${name}`,
    );
  }

  protected override onStoreSuccess(
    context: EventStoreReadContext<EventType>,
    events: readonly EventType[],
  ): void {
    this.logger.info(
      {
        tenantId: context.tenantId,
        eventCount: events.length,
        aggregateIds: [...new Set(events.map((e) => e.aggregateId))],
      },
      "Stored events to ClickHouse",
    );
  }
}
