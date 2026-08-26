import type { AppendStore } from "@langwatch/eventing";
import { AbstractMapProjection, type MapEventHandlers } from "@langwatch/eventing";
import { metricMapGroupKey } from "../adapters/metric-shards.adapter";
import { METRIC_MAP_COALESCE_MAX_BATCH } from "@langwatch/telemetry-contract";
import {
  type MetricDataPointReceivedEvent,
  metricDataPointReceivedEventSchema,
} from "../adapters/telemetry-event.adapter";
import type { CanonicalMetricDataPoint } from "@langwatch/telemetry-contract";

const events = [metricDataPointReceivedEventSchema] as const;

export class MetricTimeRollupMapProjection
  extends AbstractMapProjection<CanonicalMetricDataPoint, typeof events>
  implements MapEventHandlers<typeof events, CanonicalMetricDataPoint>
{
  static create(deps: {
    store: AppendStore<CanonicalMetricDataPoint>;
    shardCount: number;
  }): MetricTimeRollupMapProjection {
    return new MetricTimeRollupMapProjection(deps);
  }

  readonly name = "metricTimeRollup";
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
          identity: event.data.seriesId,
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
