import { createLogger } from "@langwatch/observability";
import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import {
  INDEFINITE_RETENTION_DAYS,
  PLATFORM_DEFAULT_RETENTION_DAYS,
} from "../../data-retention/retentionPolicy.schema";
import type { RetentionPolicyResolver } from "../../data-retention/retentionPolicyResolver";
import { classifyEventLogRowRetention } from "../../data-retention/event-log-retention-policy";
import type { Event } from "../domain/types";
import { AbstractEventStore } from "./abstractEventStore";
import type { EventStoreReadContext } from "./eventStore.types";
import type { EventRecord, EventRepository } from "./repositories/eventRepository.types";

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
  private readonly tracer = getLangWatchTracer("langwatch.trace-processing.event-store.clickhouse");
  private readonly logger = createLogger("langwatch:trace-processing:event-store:clickhouse");

  constructor(
    repository: EventRepository,
    private readonly retentionPolicyResolver?: RetentionPolicyResolver,
  ) {
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

  protected override logWarning(
    name: string,
    context: Record<string, unknown>,
    message: string,
  ): void {
    this.logger.warn(
      {
        ...context,
        operation: name,
      },
      message,
    );
  }

  protected override onStoreSuccess(
    _context: EventStoreReadContext<EventType>,
    _events: readonly EventType[],
  ): void {
    // no-op: removed verbose per-store logging
  }

  // Security control-plane history never expires; ClickHouse uses zero as its
  // indefinite-retention sentinel. Other rows follow their workload category,
  // resolving tenant policy once per batch or using the platform default.
  protected override async enrichRecordsForStorage(
    records: EventRecord[],
    context: EventStoreReadContext<EventType>,
  ): Promise<EventRecord[]> {
    if (records.length === 0) return records;

    const classifiedRecords = records.map((record) => ({
      record,
      retentionClass: classifyEventLogRowRetention(record),
    }));
    const hasFiniteEvents = classifiedRecords.some(
      ({ retentionClass }) => retentionClass !== "indefinite",
    );

    if (!this.retentionPolicyResolver || !hasFiniteEvents) {
      return classifiedRecords.map(({ record, retentionClass }) =>
        retentionClass === "indefinite"
          ? { ...record, _retention_days: INDEFINITE_RETENTION_DAYS }
          : record,
      );
    }

    const policy = await this.retentionPolicyResolver.resolve(String(context.tenantId));
    return classifiedRecords.map(({ record, retentionClass }) =>
      retentionClass === "indefinite"
        ? { ...record, _retention_days: INDEFINITE_RETENTION_DAYS }
        : {
            ...record,
            _retention_days: policy?.[retentionClass] ?? PLATFORM_DEFAULT_RETENTION_DAYS,
          },
    );
  }
}
