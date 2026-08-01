import {
  AbstractMapProjection,
  type MapEventHandlers,
} from "../../../projections/abstractMapProjection";
import type { AppendStore } from "../../../projections/mapProjection.types";
import { metricMapGroupKey } from "../canonical/shards";
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

  constructor(deps: {
    store: AppendStore<CanonicalMetricDataPoint>;
    shardCount: number;
  }) {
    super();
    this.store = deps.store;
    this.options = {
      groupKeyFn: (event: MetricDataPointReceivedEvent) =>
        metricMapGroupKey({
          identity: event.data.pointId,
          shardCount: deps.shardCount,
        }),
      coalesceMaxBatch: METRIC_MAP_COALESCE_MAX_BATCH,
    };
  }

  mapMetricDataPointReceived(
    event: MetricDataPointReceivedEvent,
  ): CanonicalMetricDataPoint {
    return event.data;
  }
}
