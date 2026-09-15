import type { Event } from "../../../domain/types.ts";
import type { EventStoreReadContext } from "../../../stores/eventStore.types.ts";
import type {
  EventRecord,
  EventRepository,
} from "../../../stores/repositories/eventRepository.types.ts";
import type { RetentionPolicyResolver } from "../../../runtime.types.ts";
import { AbstractEventStore } from "../../../stores/abstractEventStore.ts";
import { createLogger } from "@langwatch/observability";
import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import type { EventingRetentionConfiguration } from "../../retention.ts";

/**
 * The sentinel {@link EventLogRetentionClassifier} returns for a row that must
 * never expire (durable identity/authorization/SSO/SCIM history, virtual-key
 * lifecycle events). Any other return value is read as a key into the
 * tenant's resolved {@link RetentionPolicyResolver} policy.
 */
export const EVENT_LOG_INDEFINITE_RETENTION_CLASS = "indefinite";

/**
 * Classifies one `event_log` row for retention: a key into the tenant's
 * resolved policy, or {@link EVENT_LOG_INDEFINITE_RETENTION_CLASS}. A plain
 * function type, not an import of the concrete classifier: this package may
 * not name a product-feature module (`eventing-boundary.unit.test.ts`), so
 * the host composition root supplies the real implementation when it wires
 * this store. Omitted, every row is stamped from `"traces"`, unchanged.
 */
export type EventLogRetentionClassifier = (row: {
  AggregateType: string;
  EventType: string;
}) => string;

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
    private readonly classifyEventLogRetention?: EventLogRetentionClassifier,
  ) {
    super(repository);
  }

  static create(options: {
    repository: EventRepository;
    retention: EventingRetentionConfiguration;
    retentionPolicyResolver?: RetentionPolicyResolver;
    classifyEventLogRetention?: EventLogRetentionClassifier;
  }): EventingClickHouseEventStore {
    return new EventingClickHouseEventStore(
      options.repository,
      options.retention,
      options.retentionPolicyResolver,
      options.classifyEventLogRetention,
    );
  }

  protected override async instrument<T>(
    name: string,
    attributes: Record<string, string | number>,
    fn: () => Promise<T>,
  ): Promise<T> {
    return this.tracer.withActiveSpan(
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

  // event_log is not one category: when a classifier is wired, durable
  // authentication, authorization, SSO and SCIM history (and virtual-key
  // lifecycle events) never expire, and everything else ages with the
  // customer category its own aggregate belongs to. Without one, every row
  // is stamped from "traces", same as before this seam existed. Resolved
  // once per batch from the tenant policy and stamped per record. Retention
  // is default-on: a tenant with no override uses the process-injected
  // default, rather than the column migration default.
  protected override async enrichRecordsForStorage(
    records: EventRecord[],
    context: EventStoreReadContext<EventType>,
  ): Promise<EventRecord[]> {
    if (!this.retentionPolicyResolver || records.length === 0) return records;
    const policy = await this.retentionPolicyResolver.resolve(String(context.tenantId));
    return records.map((r) => {
      const retentionClass = this.classifyEventLogRetention?.(r) ?? "traces";
      const retentionDays =
        retentionClass === EVENT_LOG_INDEFINITE_RETENTION_CLASS
          ? 0
          : (policy?.[retentionClass] ?? this.retention.defaultRetentionDays);
      return { ...r, _retention_days: retentionDays };
    });
  }
}
