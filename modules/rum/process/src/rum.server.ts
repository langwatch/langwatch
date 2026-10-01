import { defineServerModule } from "@langwatch/process";

import { RumApp } from "./app/rum.app.ts";
import { rumRepositories } from "./repositories/rum-repositories.registry.ts";
import { rumRest } from "./transport/rum.rest.ts";

export const rumServer = defineServerModule("rum")
  .withRepositories(rumRepositories)
  .withApp(RumApp)
  .withTransports(rumRest);
