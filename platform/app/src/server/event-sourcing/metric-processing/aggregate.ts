import { defineAggregate } from "@langwatch/event-sourcing";
import { z } from "zod";
import { canonicalMetricDataPointSchema } from "./schema";

/**
 * A metric data point is immutable and content-addressed, so every point is its
 * own aggregate of exactly one event and nothing folds this state — the
 * declaration exists to name the event and its persisted type string. `prefix`
 * keeps that string byte-equal to `lw.obs.metric.data_point_received`, which is
 * already in `event_log`.
 */
export const metric = defineAggregate({
  name: "metric",
  prefix: "lw.obs",
  state: z.object({
    pointId: z.string().nullable(),
    receivedAt: z.number().nullable(),
  }),
  init: () => ({ pointId: null, receivedAt: null }),
  id: (data) => data.pointId,
  events: {
    dataPointReceived: {
      data: canonicalMetricDataPointSchema,
      apply: (_state, data) => ({
        pointId: data.pointId,
        receivedAt: data.acceptedAt,
      }),
    },
  },
  commands: {
    recordDataPoint: {
      input: canonicalMetricDataPointSchema,
      handle: (_state, input, events) => [events.dataPointReceived(input)],
    },
  },
});
