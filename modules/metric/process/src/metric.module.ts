import type { MetricApi, MetricServerConfig } from "@langwatch/metric-contract";
import { defineProcessModule, type PublishedProcessModule } from "@langwatch/process";

import { MetricModule } from "./app/metric.app.ts";
import { metricEventing } from "./eventing/metric.pipeline.ts";
import { metricRepositories } from "./repositories/metric-repositories.registry.ts";
import { otlpMetricsDoor, otlpMetricsRest } from "./transport/otlp-metrics.rest.ts";

export const metricProcessModule: PublishedProcessModule<"metric", MetricApi, MetricServerConfig> =
  defineProcessModule("metric")
    .withRepositories(metricRepositories)
    .withApi(MetricModule)
    .withTransports(otlpMetricsRest)
    .withEventing(metricEventing)
    // The exporter's key, resolved through Trace before the body (W02-DOOR-SHAPE, 2026-10-10).
    .withDoors({ otlp_ingest: otlpMetricsDoor });
