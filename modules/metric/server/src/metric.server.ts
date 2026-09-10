import { defineServerModule } from "@langwatch/runtime-composition";
import { MetricApp } from "./app/metric.app.ts";

export type { MetricInfrastructure } from "./app/metric.app.ts";

export const metricServer = defineServerModule("metric").withApp(MetricApp).build();
