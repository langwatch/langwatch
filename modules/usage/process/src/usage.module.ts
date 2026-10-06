import { defineProcessModule } from "@langwatch/process";

import { UsageModule } from "./app/usage.app.ts";
import { usageEventing } from "./eventing/usage.pipeline.ts";
import { usageRepositories } from "./repositories/usage-repositories.registry.ts";

export const usageProcessModule = defineProcessModule("usage")
  .withRepositories(usageRepositories)
  .withApi(UsageModule)
  .withEventing(usageEventing);
