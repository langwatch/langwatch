import type { AppendStore, MapProjectionDefinition } from "../../../projections/mapProjection.types";
import { LOG_RECORD_RECEIVED_EVENT_TYPE } from "../schemas/constants";
import type { LogRecordReceivedEvent } from "../schemas/events";
import type { NormalizedLogRecord } from "../schemas/logRecords";
import { IdUtils } from "../utils/id.utils";

export function createLogRecordStorageMapProjection({
  store,
}: {
  store: AppendStore<NormalizedLogRecord>;
}): MapProjectionDefinition<NormalizedLogRecord, LogRecordReceivedEvent> {
  return {
    name: "logRecordStorage",
    eventTypes: [LOG_RECORD_RECEIVED_EVENT_TYPE],

    map(event: LogRecordReceivedEvent): NormalizedLogRecord {
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
    },

    store,
  };
}
