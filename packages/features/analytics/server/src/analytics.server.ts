import { defineFeature } from "@langwatch/runtime-composition";
import { AnalyticsApp } from "./app/analytics.app.ts";

export type { AnalyticsInfrastructure } from "./app/analytics.app.ts";

export const analyticsServer = defineFeature("analytics").withApp(AnalyticsApp).build();
