import type { Event } from "../../../domain/types";
import type { EventStoreReadContext } from "../../../stores/eventStore.types";
import type {
  EventRecord,
  EventRepository,
} from "../../../stores/repositories/eventRepository.types";
import type { RetentionPolicyResolver } from "../../../runtime.types";
import { AbstractEventStore } from "../../../stores/abstractEventStore";
import { createLogger } from "@langwatch/observability";
import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import type { EventingRetentionConfiguration } from "../../retention";

/**
 * ClickHouse-backed EventStore with OpenTelemetry instrumentation and structured logging.
 *
 * Extends {@link AbstractEventStore} with:
 * - `instrument()`: wraps operations in OpenTelemetry spans
 * - `logError()`: structured error logging via pino
 * - `onStoreSuccess()`: logs successful writes with tenant/count details
 */
export class EventingClickHouseEventStore<
  EventType extends Event = Event,
> extends AbstractEventStore<EventType> {
  private readonly tracer = getLangWatchTracer("langwatch.trace-processing.event-store.clickhouse");
  private readonly logger = createLogger("langwatch:trace-processing:event-store:clickhouse");

  private constructor(
    repository: EventRepository,
    private readonly retention: EventingRetentionConfiguration,
    private readonly retentionPolicyResolver?: RetentionPolicyResolver,
  ) {
    super(repository);
  }

  static create(options: {
    repository: EventRepository;
    retention: EventingRetentionConfiguration;
    retentionPolicyResolver?: RetentionPolicyResolver;
  }): EventingClickHouseEventStore {
    return new EventingClickHouseEventStore(
      options.repository,
      options.retention,
      options.retentionPolicyResolver,
    );
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

  // event_log carries the trace category retention. Resolved once per batch
  // from the tenant policy and stamped on every record. Retention is
  // default-on: a tenant with no override uses the process-injected default,
  // rather than the column migration default.
  protected override async enrichRecordsForStorage(
    records: EventRecord[],
    context: EventStoreReadContext<EventType>,
  ): Promise<EventRecord[]> {
    if (!this.retentionPolicyResolver || records.length === 0) return records;
    const policy = await this.retentionPolicyResolver.resolve(String(context.tenantId));
    const retentionDays = policy?.traces ?? this.retention.defaultRetentionDays;
    return records.map((r) => ({ ...r, _retention_days: retentionDays }));
  }
}
