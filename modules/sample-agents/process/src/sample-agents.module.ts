import { defineProcessModule } from "@langwatch/process";

import { SampleAgentsModule } from "./app/sample-agents.app.ts";

/** hotel_bot is unmounted until the platform-operator door lands (rulings-2026-10-05, E4). */
export const sampleAgentsProcessModule = defineProcessModule("sample-agents")
  .withApi(SampleAgentsModule)
  .withTransports();
