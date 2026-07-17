import {
  AbstractMapProjection,
  type MapEventHandlers,
} from "../../../projections/abstractMapProjection";
import type { AppendStore } from "../../../projections/mapProjection.types";
import { METRIC_MAP_COALESCE_MAX_BATCH } from "../schemas/constants";
import {
  type MetricDataPointReceivedEvent,
  metricDataPointReceivedEventSchema,
} from "../schemas/events";
import type { CanonicalMetricDataPoint } from "../schemas/metricDataPoint";

const events = [metricDataPointReceivedEventSchema] as const;

export class MetricDataPointStorageMapProjection
  extends AbstractMapProjection<CanonicalMetricDataPoint, typeof events>
  implements MapEventHandlers<typeof events, CanonicalMetricDataPoint>
{
  readonly name = "metricDataPointStorage";
  readonly store: AppendStore<CanonicalMetricDataPoint>;
  protected readonly events = events;
  override options = {
    groupKeyFn: () => "tenant-batch",
    coalesceMaxBatch: METRIC_MAP_COALESCE_MAX_BATCH,
  };

  constructor(deps: { store: AppendStore<CanonicalMetricDataPoint> }) {
    super();
    this.store = deps.store;
  }

  mapMetricDataPointReceived(
    event: MetricDataPointReceivedEvent,
  ): CanonicalMetricDataPoint {
    return event.data;
  }
}
