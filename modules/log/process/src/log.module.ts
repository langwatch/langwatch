import { defineProcessModule } from "@langwatch/process";

import { LogModule } from "./app/log.app.ts";
import { logEventing } from "./eventing/log.pipeline.ts";
import { logRepositories } from "./repositories/log-repositories.registry.ts";
import { otlpLogsRest } from "./transport/otlp-logs.rest.ts";

export const logProcessModule = defineProcessModule("log")
  .withRepositories(logRepositories)
  .withApi(LogModule)
  .withTransports(otlpLogsRest)
  .withEventing(logEventing);
