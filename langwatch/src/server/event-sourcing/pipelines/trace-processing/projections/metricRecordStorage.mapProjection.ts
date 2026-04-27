import { AbstractMapProjection, type MapEventHandlers } from "../../../projections/abstractMapProjection";
import type { AppendStore } from "../../../projections/mapProjection.types";
import { metricRecordReceivedEventSchema, type MetricRecordReceivedEvent } from "../schemas/events";
import type { NormalizedMetricRecord } from "../schemas/metricRecords";
import { IdUtils } from "../utils/id.utils";

const metricEvents = [metricRecordReceivedEventSchema] as const;

/**
 * Map projection that transforms MetricRecordReceivedEvents into NormalizedMetricRecords.
 * The framework handles dispatch and persistence via the AppendStore.
 */
export class MetricRecordStorageMapProjection
  extends AbstractMapProjection<NormalizedMetricRecord, typeof metricEvents>
  implements MapEventHandlers<typeof metricEvents, NormalizedMetricRecord>
{
  readonly name = "metricRecordStorage";
  readonly store: AppendStore<NormalizedMetricRecord>;
  protected readonly events = metricEvents;

  override options = {
    groupKeyFn: (event: { id: string }) => `metric:${event.id}`,
  };

  constructor(deps: { store: AppendStore<NormalizedMetricRecord> }) {
    super();
    this.store = deps.store;
  }

  mapTraceMetricRecordReceived(event: MetricRecordReceivedEvent): NormalizedMetricRecord {
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
  }
}
