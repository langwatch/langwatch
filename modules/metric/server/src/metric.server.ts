import { defineServerModule } from "@langwatch/kernel";
import { MetricApp } from "./app/metric.app.ts";

export const metricServer = defineServerModule("metric").withApp(MetricApp).build();
