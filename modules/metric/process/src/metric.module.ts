import { defineProcessModule } from "@langwatch/process";

import { MetricModule } from "./app/metric.app.ts";
import { metricEventing } from "./eventing/metric.pipeline.ts";
import { otlpMetricsRest } from "./transport/otlp-metrics.rest.ts";

export const metricProcessModule = defineProcessModule("metric")
  .withApi(MetricModule)
  .withTransports(otlpMetricsRest)
  .withEventing(metricEventing);
