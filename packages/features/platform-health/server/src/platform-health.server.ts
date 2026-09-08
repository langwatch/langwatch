import { defineFeature } from "@langwatch/runtime-composition";
import { PlatformHealthApp } from "./app/platform-health.app.ts";
import { platformHealthRest } from "./transport/platform-health.rest.ts";

export type { PlatformHealthInfrastructure } from "./app/platform-health.app.ts";

export const platformHealthServer = defineFeature("platform-health")
  .withApp(PlatformHealthApp)
  .withTransports(platformHealthRest)
  .build();
