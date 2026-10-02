import { defineProcessModule } from "@langwatch/process";

import { UsageModule } from "./app/usage.app.ts";
import { usageEventing } from "./eventing/usage.pipeline.ts";

export const usageProcessModule = defineProcessModule("usage")
  .withApi(UsageModule)
  .withEventing(usageEventing);
