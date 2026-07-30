import { defineAggregate } from "@langwatch/event-sourcing";
import { z } from "zod";
import {
  type CanonicalMetricDataPoint,
  canonicalMetricDataPointSchema,
} from "./schema";

/**
 * The metric aggregate (ADR-105).
 *
 * A metric data point is immutable and content-addressed: `pointId` is
 * `sha256(seriesId + canonical payload)` (`canonical/buildPoint.ts`), so the
 * same measurement always derives the same identity, and every point is its
 * own aggregate of exactly one event — there is no lifetime to accumulate, so
 * every projection mounted on this aggregate is a `map`, never a `fold`
 * (ADR-098 decision 2). The aggregate declaration is still required — it is
 * what names the event and its persisted type string — even though nothing
 * ever folds this state.
 *
 * `state` mirrors the last (only) event applied, purely so the aggregate has
 * something to report; nothing reads it back, because nothing mounts a fold
 * here.
 */
const metricPointStateSchema = z.object({
  pointId: z.string().nullable(),
  receivedAt: z.number().nullable(),
});

export const metric = defineAggregate("metric")
  .state(metricPointStateSchema, () => ({ pointId: null, receivedAt: null }))
  .events({
    dataPointReceived: {
      data: canonicalMetricDataPointSchema,
      apply: (_state, data) => ({
        pointId: data.pointId,
        receivedAt: data.acceptedAt,
      }),
    },
  })
  .commands({
    recordDataPoint: {
      input: canonicalMetricDataPointSchema,
      handle: (_state, input, events) => [events.dataPointReceived(input)],
    },
  })
  .build();

export type MetricDataPointReceivedEvent = ReturnType<
  typeof metric.events.dataPointReceived
>;

/**
 * A metric data point is content-addressed, so its own `pointId` is its
 * aggregate id — there is nothing else that could identify "the same
 * measurement" more precisely than the hash already does.
 */
export function metricAggregateId(data: CanonicalMetricDataPoint): string {
  return data.pointId;
}
