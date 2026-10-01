import { defineServerModule } from "@langwatch/kernel";

import { LogApp } from "./app/log.app.ts";
import { logEventing } from "./eventing/log.pipeline.ts";
import { otlpLogsRest } from "./transport/otlp-logs.rest.ts";

export type { LogInfrastructure } from "./app/log.app.ts";

export const logServer = defineServerModule("log")
  .withApp(LogApp)
  .withTransports(otlpLogsRest)
  .withEventing(logEventing);
