import { defineServerModule } from "@langwatch/kernel";

import { MetricApp } from "./app/metric.app.ts";
import { metricEventing } from "./eventing/metric.pipeline.ts";
import { otlpMetricsRest } from "./transport/otlp-metrics.rest.ts";

export const metricServer = defineServerModule("metric")
  .withApp(MetricApp)
  .withTransports(otlpMetricsRest)
  .withEventing(metricEventing);
