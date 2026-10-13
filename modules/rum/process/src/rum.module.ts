import { defineProcessModule, type PublishedProcessModule } from "@langwatch/process";
import type { RumApi, RumConfig } from "@langwatch/rum-contract";

import { RumModule } from "./app/rum.app.ts";
import { rumChannels } from "./channels/rum-channels.registry.ts";
import { rumRepositories } from "./repositories/rum-repositories.registry.ts";
import { rumRest } from "./transport/rum.rest.ts";

export const rumProcessModule: PublishedProcessModule<"rum", RumApi, RumConfig> =
  defineProcessModule("rum")
    .withRepositories(rumRepositories)
    .withChannels(rumChannels)
    .withApi(RumModule)
    .withTransports(rumRest);
