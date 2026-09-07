import { defineFeature } from "@langwatch/runtime-composition";
import { PlatformHealthApp } from "./app/platform-health.app.ts";

export type { PlatformHealthInfrastructure } from "./app/platform-health.app.ts";

export const platformHealthServer = defineFeature("platform-health")
  .withApp(PlatformHealthApp)
  .build();
