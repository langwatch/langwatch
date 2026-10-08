import { defineProcessModule } from "@langwatch/process";

import { RumModule } from "./app/rum.app.ts";
import { rumChannels } from "./channels/rum-channels.registry.ts";
import { rumRepositories } from "./repositories/rum-repositories.registry.ts";
import { rumRest } from "./transport/rum.rest.ts";

export const rumProcessModule = defineProcessModule("rum")
  .withRepositories(rumRepositories)
  .withChannels(rumChannels)
  .withApi(RumModule)
  .withTransports(rumRest);
