import { defineServerModule } from "@langwatch/kernel";

import { LogApp } from "./app/log.app.ts";
import { logEventing } from "./eventing/log.pipeline.ts";

export type { LogInfrastructure } from "./app/log.app.ts";

export const logServer = defineServerModule("log").withApp(LogApp).withEventing(logEventing);
