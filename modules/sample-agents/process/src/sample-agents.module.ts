import { defineProcessModule } from "@langwatch/process";

import { SampleAgentsModule } from "./app/sample-agents.app.ts";
import { hotelBotRest } from "./transport/hotel-bot.rest.ts";

export const sampleAgentsProcessModule = defineProcessModule("sample-agents")
  .withApi(SampleAgentsModule)
  .withTransports(hotelBotRest);
