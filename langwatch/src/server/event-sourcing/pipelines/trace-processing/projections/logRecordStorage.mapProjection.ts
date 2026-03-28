import { AbstractMapProjection, type MapEventHandlers } from "../../../projections/abstractMapProjection";
import type { AppendStore } from "../../../projections/mapProjection.types";
import { logRecordReceivedEventSchema, type LogRecordReceivedEvent } from "../schemas/events";
import type { NormalizedLogRecord } from "../schemas/logRecords";
import { IdUtils } from "../utils/id.utils";

const logEvents = [logRecordReceivedEventSchema] as const;

/**
 * Map projection that transforms LogRecordReceivedEvents into NormalizedLogRecords.
 * The framework handles dispatch and persistence via the AppendStore.
 */
export class LogRecordStorageMapProjection
  extends AbstractMapProjection<NormalizedLogRecord, typeof logEvents>
  implements MapEventHandlers<typeof logEvents, NormalizedLogRecord>
{
  readonly name = "logRecordStorage";
  readonly store: AppendStore<NormalizedLogRecord>;
  protected readonly events = logEvents;

  override options = {
    groupKeyFn: (event: { id: string }) => `log:${event.id}`,
  };

  constructor(deps: { store: AppendStore<NormalizedLogRecord> }) {
    super();
    this.store = deps.store;
  }

  mapTraceLogRecordReceived(event: LogRecordReceivedEvent): NormalizedLogRecord {
    return {
      id: IdUtils.generateDeterministicLogRecordId(event),
      tenantId: event.tenantId,
      traceId: event.data.traceId,
      spanId: event.data.spanId,
      timeUnixMs: event.data.timeUnixMs,
      severityNumber: event.data.severityNumber,
      severityText: event.data.severityText,
      body: event.data.body,
      attributes: event.data.attributes,
      resourceAttributes: event.data.resourceAttributes,
      scopeName: event.data.scopeName,
      scopeVersion: event.data.scopeVersion,
    };
  }
}
