import { createLogger } from "@langwatch/observability";
import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";

import type { Event } from "../../../domain/types.ts";
import type { RetentionPolicy, RetentionPolicyResolver } from "../../../runtime.types.ts";
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

/** The tenant retention a row's own pipeline declares, by aggregate type (`.withRetention`). */
export type EventLogRetentionPolicyLookup = (
  aggregateType: string,
) => RetentionPolicyResolver | undefined;

interface EventingClickHouseEventStoreOptions {
  repository: EventRepository;
  retention: EventingRetentionConfiguration;
  /** Every row's tenant retention; a pipeline's own, from `retentionPolicyFor`, wins. */
  retentionPolicyResolver?: RetentionPolicyResolver;
  retentionPolicyFor?: EventLogRetentionPolicyLookup;
  classifyEventLogRetention?: EventLogRetentionClassifier;
}

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
  private readonly retentionPolicyFor?: EventLogRetentionPolicyLookup;
  private readonly classifyEventLogRetention?: EventLogRetentionClassifier;

  private constructor(options: EventingClickHouseEventStoreOptions) {
    super(options.repository);
    this.retention = options.retention;
    this.retentionPolicyResolver = options.retentionPolicyResolver;
    this.retentionPolicyFor = options.retentionPolicyFor;
    this.classifyEventLogRetention = options.classifyEventLogRetention;
  }

  static create(options: EventingClickHouseEventStoreOptions): EventingClickHouseEventStore {
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

  // A row the classifier calls indefinite stamps 0 (kept forever), as on main. Any other row
  // takes the tenant policy for its class from its pipeline's resolver, else the process default.
  // No classifier: every row is "traces". Spec: packages/eventing/specs/pipeline-retention.feature.
  protected override async enrichRecordsForStorage(
    records: EventRecord[],
    context: EventStoreReadContext<EventType>,
  ): Promise<EventRecord[]> {
    if (records.length === 0) return records;
    const policies = new Map<string, Promise<RetentionPolicy | null>>();
    const policyOf = (aggregateType: string) => {
      const resolver = this.retentionPolicyFor?.(aggregateType) ?? this.retentionPolicyResolver;
      if (!resolver) return undefined;
      const known = policies.get(aggregateType);
      if (known) return known;
      const resolving = resolver.resolve(String(context.tenantId));
      policies.set(aggregateType, resolving);
      return resolving;
    };
    return Promise.all(
      records.map(async (record) => {
        const retentionClass = this.classifyEventLogRetention?.(record) ?? "traces";
        if (retentionClass === EVENT_LOG_INDEFINITE_RETENTION_CLASS) {
          return { ...record, _retention_days: 0 };
        }
        const resolving = policyOf(record.AggregateType);
        if (!resolving) return record;
        const policy = await resolving;
        return {
          ...record,
          _retention_days: policy?.[retentionClass] ?? this.retention.defaultRetentionDays,
        };
      }),
    );
  }
}
