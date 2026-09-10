import { bindRestHeader } from "@langwatch/api/rest";
import { defineServerModule } from "@langwatch/runtime-composition";
import { PlatformHealthApp } from "./app/platform-health.app.ts";
import { platformHealthAuthorization, platformHealthRest } from "./transport/platform-health.rest.ts";

export type { PlatformHealthInfrastructure } from "./app/platform-health.app.ts";

export const platformHealthServer = defineServerModule("platform-health")
  .withApp(PlatformHealthApp)
  .withTransports(platformHealthRest)
  // The monitoring key is checked by the application against its own config,
  // so the header reaches it whole rather than through a door.
  .withTransportFacts(() => [bindRestHeader(platformHealthAuthorization, "authorization")])
  .build();
