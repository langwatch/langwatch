import {
  AbstractMapProjection,
  type MapEventHandlers,
} from "../../../projections/abstractMapProjection";
import type { AppendStore } from "../../../projections/mapProjection.types";
import type { CanonicalMetricDataPoint } from "../schemas/metricDataPoint";
import {
  metricDataPointReceivedEventSchema,
  type MetricDataPointReceivedEvent,
} from "../schemas/events";

const events = [metricDataPointReceivedEventSchema] as const;

export class MetricTimeRollupMapProjection
  extends AbstractMapProjection<CanonicalMetricDataPoint, typeof events>
  implements MapEventHandlers<typeof events, CanonicalMetricDataPoint>
{
  readonly name = "metricTimeRollup";
  readonly store: AppendStore<CanonicalMetricDataPoint>;
  protected readonly events = events;
  override options = {
    groupKeyFn: (event: MetricDataPointReceivedEvent) =>
      `rollup:${event.data.seriesId}`,
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
