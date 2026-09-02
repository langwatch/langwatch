import {
  TraceClickHousePort,
  type TraceClickHouseClient,
  type TraceClickHouseResolver,
} from "../ports/clickhouse.port";
import { TracePayloadReaderPort } from "../ports/trace-payload-reader.port";
import { ClickHouseTraceEventPayloadRepository } from "../repositories/clickhouse/trace-event-payload.repository";

/**
 * The aggregate every offloaded trace field is stored under.
 *
 * A literal in both graphs: `event_log` is keyed by
 * `(TenantId, AggregateType, AggregateId, EventId)`, so a reader that asks for
 * the wrong aggregate type matches no row and returns the 64 KB preview instead
 * of the offloaded value — a silent degradation, not an error.
 */
export const TRACE_PAYLOAD_AGGREGATE_TYPE = "trace";

/**
 * The event_log claim-check read behind the narrow port Trace declares.
 *
 * Absence is the contract: `tryRead` answers null for a missing row, a missing
 * field, a corrupt payload and an unreachable cluster alike, because every one
 * of them means the same thing to the caller — this field cannot be recalled,
 * serve the preview. The application's adapter swallows identically.
 */
export class ClickHouseTracePayloadReaderAdapter extends TracePayloadReaderPort {
  static create(options: {
    resolveClient: TraceClickHouseResolver;
  }): ClickHouseTracePayloadReaderAdapter {
    return new ClickHouseTracePayloadReaderAdapter(
      ClickHouseTraceEventPayloadRepository.create(
        new ResolvedTraceClickHousePort(options.resolveClient),
      ),
    );
  }

  private constructor(private readonly payloads: ClickHouseTraceEventPayloadRepository) {
    super();
  }

  async tryRead(input: {
    tenantId: string;
    traceId: string;
    eventId: string;
    field: string;
  }): Promise<string | null> {
    try {
      return await this.payloads.getField({
        eventId: input.eventId,
        field: input.field,
        tenantId: input.tenantId,
        aggregateType: TRACE_PAYLOAD_AGGREGATE_TYPE,
        aggregateId: input.traceId,
      });
    } catch {
      return null;
    }
  }
}

/** The tenant-keyed resolver a composition root holds, as the port the repository names. */
class ResolvedTraceClickHousePort extends TraceClickHousePort {
  constructor(private readonly resolveClient: TraceClickHouseResolver) {
    super();
  }

  resolve(tenantId: string): Promise<TraceClickHouseClient> {
    return this.resolveClient(tenantId);
  }
}
