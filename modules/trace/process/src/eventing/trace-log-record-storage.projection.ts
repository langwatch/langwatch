import {
  type AppendStore,
  AbstractMapProjection,
  type MapEventHandlers,
} from "@langwatch/eventing";
import {
  type CanonicalLogRecord,
  type CanonicalLogRecordReceivedEvent,
  canonicalLogRecordReceivedEventSchema,
} from "@langwatch/log-contract";
import { z } from "zod";

import type { StoredLogRecordWrite } from "../repositories/log-record-storage.repository.ts";

const flatAttributesSchema = z.record(z.string(), z.string());

const events = [canonicalLogRecordReceivedEventSchema] as const;

/** Whether log correlated the record to a trace; trace stores only those. */
export function isTraceCorrelated(record: CanonicalLogRecord): boolean {
  return record.correlationTraceId !== "";
}

/**
 * Trace's copy of a log record, in log's trace read shape.
 * Spec: modules/trace/specs/trace-log-record-storage.feature
 */
export function storedLogRecordOf(record: CanonicalLogRecord): StoredLogRecordWrite {
  const attributes = flatAttributesSchema.parse(JSON.parse(record.attributesFlatJson));
  if (record.eventName && attributes["event.name"] === undefined) {
    attributes["event.name"] = record.eventName;
  }
  return {
    tenantId: record.tenantId,
    recordId: record.recordId,
    traceId: record.correlationTraceId,
    spanId: record.correlationSpanId,
    timeUnixMs: record.timeUnixMs,
    severityNumber: record.severityNumber,
    severityText: record.severityText,
    body: record.bodyText ?? "",
    attributes,
    resourceAttributes: flatAttributesSchema.parse(JSON.parse(record.resourceAttributesFlatJson)),
    scopeName: record.scopeName,
    scopeVersion: record.scopeVersion || null,
    acceptedAtMs: record.acceptedAt,
  };
}

/** Maps log's record fact into trace's `stored_log_records`, the table trace's log reads use. */
export class TraceLogRecordStorageMapProjection
  extends AbstractMapProjection<StoredLogRecordWrite, typeof events>
  implements MapEventHandlers<typeof events, StoredLogRecordWrite>
{
  static create(deps: {
    store: AppendStore<StoredLogRecordWrite>;
  }): TraceLogRecordStorageMapProjection {
    return new TraceLogRecordStorageMapProjection(deps);
  }

  readonly name = "traceLogRecordStorage";
  readonly targetTable = "stored_log_records";
  readonly store: AppendStore<StoredLogRecordWrite>;
  protected readonly events = events;

  override options = {
    // Records are independent rows keyed by record id: no ordering between them matters.
    groupKeyFn: (event: { id: string }): string => `trace-log-record:${event.id}`,
    onExhausted: "dead-letter" as const,
  };

  private constructor(deps: { store: AppendStore<StoredLogRecordWrite> }) {
    super();
    this.store = deps.store;
  }

  mapLogRecordReceived(event: CanonicalLogRecordReceivedEvent): StoredLogRecordWrite | null {
    return isTraceCorrelated(event.data) ? storedLogRecordOf(event.data) : null;
  }
}
