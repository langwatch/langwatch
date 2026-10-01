import { defineProcessModule } from "@langwatch/process";

import { LogModule } from "./app/log.app.ts";
import { logEventing } from "./eventing/log.pipeline.ts";
import { otlpLogsRest } from "./transport/otlp-logs.rest.ts";

export type { LogInfrastructure } from "./app/log.app.ts";

export const logProcessModule = defineProcessModule("log")
  .withApi(LogModule)
  .withTransports(otlpLogsRest)
  .withEventing(logEventing);
