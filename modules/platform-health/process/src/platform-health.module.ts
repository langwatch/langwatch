import { bindRestHeader } from "@langwatch/api/rest";
import { defineProcessModule } from "@langwatch/process";

import { PlatformHealthModule } from "./app/platform-health.app.ts";
import {
  platformHealthLangyProbeRest,
  platformHealthProbeRest,
} from "./transport/platform-health-probe.rest.ts";
import {
  platformHealthAuthorization,
  platformHealthRest,
} from "./transport/platform-health.rest.ts";

export type { PlatformHealthInfrastructure } from "./app/platform-health.app.ts";

export const platformHealthProcessModule = defineProcessModule("platform-health")
  .withApi(PlatformHealthModule)
  .withTransports(platformHealthRest, platformHealthProbeRest, platformHealthLangyProbeRest)
  // The monitoring key is checked by the application against its own config,
  // so the header reaches it whole rather than through a door.
  .withTransportFacts(() => [bindRestHeader(platformHealthAuthorization, "authorization")]);
