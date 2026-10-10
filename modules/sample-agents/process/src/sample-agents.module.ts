import { defineProcessModule } from "@langwatch/process";

import { SampleAgentsModule } from "./app/sample-agents.app.ts";
import { sampleAgentsChannels } from "./channels/sample-agents-channels.registry.ts";
import { hotelBotRest } from "./transport/hotel-bot.rest.ts";

/** hotel_bot answers a project API key holding traces:create (Alex 2026-10-10 W02-HOTEL-BOT). */
export const sampleAgentsProcessModule = defineProcessModule("sample-agents")
  .withChannels(sampleAgentsChannels)
  .withApi(SampleAgentsModule)
  .withTransports(hotelBotRest);
