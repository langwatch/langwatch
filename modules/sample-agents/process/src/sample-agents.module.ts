import { defineProcessModule } from "@langwatch/process";

import { SampleAgentsModule } from "./app/sample-agents.app.ts";
import { hotelBotRest } from "./transport/hotel-bot.rest.ts";

/** hotel_bot answers platform operators only, behind the browser door (rulings-2026-10-05, E4). */
export const sampleAgentsProcessModule = defineProcessModule("sample-agents")
  .withApi(SampleAgentsModule)
  .withTransports(hotelBotRest);
