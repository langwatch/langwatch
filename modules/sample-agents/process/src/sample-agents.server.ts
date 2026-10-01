import { defineServerModule } from "@langwatch/kernel";

import { SampleAgentsApp } from "./app/sample-agents.app.ts";
import { hotelBotRest } from "./transport/hotel-bot.rest.ts";

export const sampleAgentsServer = defineServerModule("sample-agents")
  .withApp(SampleAgentsApp)
  .withTransports(hotelBotRest);
