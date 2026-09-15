import { defineServerModule } from "@langwatch/runtime-composition";
import { LogApp } from "./app/log.app.ts";

export type { LogInfrastructure } from "./app/log.app.ts";

export const logServer = defineServerModule("log").withApp(LogApp).build();
