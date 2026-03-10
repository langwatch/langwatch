import type { AppendStore, MapProjectionDefinition } from "../../../projections/mapProjection.types";
import { METRIC_RECORD_RECEIVED_EVENT_TYPE } from "../schemas/constants";
import type { MetricRecordReceivedEvent } from "../schemas/events";
import type { NormalizedMetricRecord } from "../schemas/metricRecords";
import { IdUtils } from "../utils/id.utils";

export function createMetricRecordStorageMapProjection({
  store,
}: {
  store: AppendStore<NormalizedMetricRecord>;
}): MapProjectionDefinition<NormalizedMetricRecord, MetricRecordReceivedEvent> {
  return {
    name: "metricRecordStorage",
    eventTypes: [METRIC_RECORD_RECEIVED_EVENT_TYPE],

    map(event: MetricRecordReceivedEvent): NormalizedMetricRecord {
      return {
        id: IdUtils.generateDeterministicMetricRecordId(event),
        tenantId: event.tenantId,
        traceId: event.data.traceId,
        spanId: event.data.spanId,
        metricName: event.data.metricName,
        metricUnit: event.data.metricUnit,
        metricType: event.data.metricType,
        value: event.data.value,
        timeUnixMs: event.data.timeUnixMs,
        attributes: event.data.attributes,
        resourceAttributes: event.data.resourceAttributes,
      };
    },

    store,
  };
}
