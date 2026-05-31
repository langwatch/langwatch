import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import type { Event } from "../domain/types";
import type { EventStoreReadContext } from "./eventStore.types";
import { createLogger } from "../../../utils/logger/server";
import { AbstractEventStore } from "./abstractEventStore";
import type {
  EventRecord,
  EventRepository,
} from "./repositories/eventRepository.types";
import type { RetentionPolicyResolver } from "../../data-retention/retentionPolicyResolver";

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

  protected override onStoreSuccess(
    _context: EventStoreReadContext<EventType>,
    _events: readonly EventType[],
  ): void {
    // no-op: removed verbose per-store logging
  }

  // event_log carries the trace category retention. Resolved once per batch
  // from the tenant policy and stamped on every record; the repo's `?? 0`
  // fallback then only applies when the resolver is missing (e.g. tests).
  protected override async enrichRecordsForStorage(
    records: EventRecord[],
    context: EventStoreReadContext<EventType>,
  ): Promise<EventRecord[]> {
    if (!this.retentionPolicyResolver || records.length === 0) return records;
    const policy = await this.retentionPolicyResolver.resolve(
      String(context.tenantId),
    );
    const retentionDays = policy?.traces ?? 0;
    if (retentionDays === 0) return records;
    return records.map((r) => ({ ...r, _retention_days: retentionDays }));
  }
}
