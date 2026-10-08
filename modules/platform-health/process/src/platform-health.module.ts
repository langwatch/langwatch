import { bindRestCredential } from "@langwatch/api/rest";
import type {
  PlatformHealthApi,
  PlatformHealthServerConfig,
} from "@langwatch/platform-health-contract";
import { defineProcessModule, type PublishedProcessModule } from "@langwatch/process";

import { PlatformHealthModule } from "./app/platform-health.app.ts";
import { platformHealthChannels } from "./channels/platform-health-channels.registry.ts";
import {
  platformHealthLangyProbeRest,
  platformHealthProbeRest,
} from "./transport/platform-health-probe.rest.ts";
import { platformHealthRest } from "./transport/platform-health.rest.ts";

export const platformHealthProcessModule: PublishedProcessModule<
  "platform-health",
  PlatformHealthApi,
  PlatformHealthServerConfig
> = defineProcessModule("platform-health")
  .withChannels(platformHealthChannels)
  .withApi(PlatformHealthModule)
  .withTransports(platformHealthRest, platformHealthProbeRest, platformHealthLangyProbeRest)
  .withTransportFacts(({ app }) => {
    if (!(app instanceof PlatformHealthModule))
      throw new TypeError("Platform health transport requires its constructed application");
    return [bindRestCredential("internal_secret", () => app.monitorDoor)];
  });
