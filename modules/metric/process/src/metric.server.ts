import { defineServerModule } from "@langwatch/kernel";

import { MetricApp } from "./app/metric.app.ts";
import { metricEventing } from "./eventing/metric.pipeline.ts";

export const metricServer = defineServerModule("metric")
  .withApp(MetricApp)
  .withEventing(metricEventing);
