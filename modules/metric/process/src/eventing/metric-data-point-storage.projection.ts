import {
  type AppendStore,
  AbstractMapProjection,
  type MapEventHandlers,
} from "@langwatch/eventing";
import {
  METRIC_MAP_COALESCE_MAX_BATCH,
  type MetricDataPointReceivedEvent,
  metricDataPointReceivedEventSchema,
  type CanonicalMetricDataPoint,
} from "@langwatch/metric-contract";

import { metricMapGroupKey } from "../rules/metric-command-lanes.rules.ts";

const events = [metricDataPointReceivedEventSchema] as const;

export class MetricDataPointStorageMapProjection
  extends AbstractMapProjection<CanonicalMetricDataPoint, typeof events>
  implements MapEventHandlers<typeof events, CanonicalMetricDataPoint>
{
  static create(deps: {
    store: AppendStore<CanonicalMetricDataPoint>;
    shardCount: number;
  }): MetricDataPointStorageMapProjection {
    return new MetricDataPointStorageMapProjection(deps);
  }

  readonly name = "metricDataPointStorage";
  readonly store: AppendStore<CanonicalMetricDataPoint>;
  protected readonly events = events;

  constructor(deps: { store: AppendStore<CanonicalMetricDataPoint>; shardCount: number }) {
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

  mapMetricDataPointReceived(event: MetricDataPointReceivedEvent): CanonicalMetricDataPoint {
    return event.data;
  }
}
