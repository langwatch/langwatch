import { bindRestCredential } from "@langwatch/api/rest";
import { defineProcessModule } from "@langwatch/process";

import { PlatformHealthModule } from "./app/platform-health.app.ts";
import {
  platformHealthLangyProbeRest,
  platformHealthProbeRest,
} from "./transport/platform-health-probe.rest.ts";
import { platformHealthRest } from "./transport/platform-health.rest.ts";

export type { PlatformHealthInfrastructure } from "./app/platform-health.app.ts";

export const platformHealthProcessModule = defineProcessModule("platform-health")
  .withApi(PlatformHealthModule)
  .withTransports(platformHealthRest, platformHealthProbeRest, platformHealthLangyProbeRest)
  .withTransportFacts(({ app }) => {
    if (!(app instanceof PlatformHealthModule))
      throw new TypeError("Platform health transport requires its constructed application");
    return [bindRestCredential("internal_secret", () => app.monitorDoor)];
  });
