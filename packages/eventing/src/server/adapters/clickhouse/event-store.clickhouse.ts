import { createLogger } from "@langwatch/observability";
import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";

import type { Event } from "../../../domain/types.ts";
import type { RetentionPolicyResolver } from "../../../runtime.types.ts";
import { AbstractEventStore } from "../../../stores/abstractEventStore.ts";
import type { EventStoreReadContext } from "../../../stores/eventStore.types.ts";
import type {
  EventRecord,
  EventRepository,
} from "../../../stores/repositories/eventRepository.types.ts";
import type { EventingRetentionConfiguration } from "../../eventing-server-runtime.ts";

/**
 * The sentinel {@link EventLogRetentionClassifier} returns for a row that must
 * never expire (durable identity/auth/SSO/SCIM history, virtual-key lifecycle
 * events). Any other value is a key into the tenant's resolved policy.
 */
export const EVENT_LOG_INDEFINITE_RETENTION_CLASS = "indefinite";

/**
 * Classifies one `event_log` row for retention: a key into the tenant's
 * policy, or {@link EVENT_LOG_INDEFINITE_RETENTION_CLASS}. Kept as a plain
 * function type since this package may not import a product-feature module.
 */
export type EventLogRetentionClassifier = (row: {
  AggregateType: string;
  EventType: string;
}) => string;

/**
 * ClickHouse-backed EventStore with OpenTelemetry instrumentation and
 * structured logging: wraps operations in spans, logs errors via pino, and
 * logs successful writes with tenant/count details.
 */
export class EventingClickHouseEventStore<
  EventType extends Event = Event,
> extends AbstractEventStore<EventType> {
  private readonly tracer = getLangWatchTracer("langwatch.trace-processing.event-store.clickhouse");
  private readonly logger = createLogger("langwatch:trace-processing:event-store:clickhouse");

  private readonly retention: EventingRetentionConfiguration;
  private readonly retentionPolicyResolver?: RetentionPolicyResolver;
  private readonly classifyEventLogRetention?: EventLogRetentionClassifier;

  private constructor(options: {
    repository: EventRepository;
    retention: EventingRetentionConfiguration;
    retentionPolicyResolver?: RetentionPolicyResolver;
    classifyEventLogRetention?: EventLogRetentionClassifier;
  }) {
    super(options.repository);
    this.retention = options.retention;
    this.retentionPolicyResolver = options.retentionPolicyResolver;
    this.classifyEventLogRetention = options.classifyEventLogRetention;
  }

  static create(options: {
    repository: EventRepository;
    retention: EventingRetentionConfiguration;
    retentionPolicyResolver?: RetentionPolicyResolver;
    classifyEventLogRetention?: EventLogRetentionClassifier;
  }): EventingClickHouseEventStore {
    return new EventingClickHouseEventStore(options);
  }

  protected override async instrument<T>(
    name: string,
    attributes: Record<string, string | number>,
    fn: () => Promise<T>,
  ): Promise<T> {
    return this.tracer.withActiveSpan(name, { kind: SpanKind.INTERNAL, attributes }, async () =>
      fn(),
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

  // With a classifier wired, a row it calls indefinite stamps 0 (kept forever) with or without
  // a tenant policy, as on main; any other row ages with its category, or the process default.
  // Without one, every row stamps "traces".
  // Spec: packages/eventing/specs/pipeline-retention.feature.
  protected override async enrichRecordsForStorage(
    records: EventRecord[],
    context: EventStoreReadContext<EventType>,
  ): Promise<EventRecord[]> {
    if (records.length === 0) return records;
    const classified = records.map((record) => ({
      record,
      retentionClass: this.classifyEventLogRetention?.(record) ?? "traces",
    }));
    const finite = classified.some(
      ({ retentionClass }) => retentionClass !== EVENT_LOG_INDEFINITE_RETENTION_CLASS,
    );
    const policy =
      finite && this.retentionPolicyResolver
        ? await this.retentionPolicyResolver.resolve(String(context.tenantId))
        : undefined;
    return classified.map(({ record, retentionClass }) => {
      if (retentionClass === EVENT_LOG_INDEFINITE_RETENTION_CLASS) {
        return { ...record, _retention_days: 0 };
      }
      if (!this.retentionPolicyResolver) return record;
      return {
        ...record,
        _retention_days: policy?.[retentionClass] ?? this.retention.defaultRetentionDays,
      };
    });
  }
}
