import { defineEventingModule, type EventingSetup } from "@langwatch/eventing";
import { METRIC_PROCESSING_PIPELINE_NAME } from "@langwatch/metric-contract";

import type { MetricApp } from "../app/metric.app.ts";

/**
 * The registration: the app builds the definition, and the senders are bound
 * back to it once the runtime has built them (ADR-144). Cross-pipeline
 * subscribers (e.g. coding-agent metric-facts) are absent until that peer's
 * own `*Api` operation exists.
 */
export const metricEventing = defineEventingModule({
  pipeline: METRIC_PROCESSING_PIPELINE_NAME,
  build: ({ app }: EventingSetup<never, MetricApp>) => app.eventingPipeline(),
  connect: ({ app, commands }) => app.connectCommands(commands),
});
