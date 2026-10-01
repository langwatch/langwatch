import { defineEventingModule, type EventingSetup } from "@langwatch/eventing";
import { METRIC_PROCESSING_PIPELINE_NAME } from "@langwatch/metric-contract";

import type { MetricModule } from "../app/metric.app.ts";

/**
 * The registration: the app builds the definition, and the senders are bound back to it once the
 * runtime has built them (ADR-144). A peer that reacts to a point declares its own peer
 * subscriber on this event.
 */
export const metricEventing = defineEventingModule({
  pipeline: METRIC_PROCESSING_PIPELINE_NAME,
  build: ({ app }: EventingSetup<never, MetricModule>) => app.eventingPipeline(),
  connect: ({ app, commands }) => app.connectCommands(commands),
});
