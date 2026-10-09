import { defineProcessModule } from "@langwatch/process";

import { InsightModule } from "./app/insight.app.ts";
import { insightEventing } from "./eventing/insight.pipeline.ts";
import { insightRepositories } from "./repositories/insight-repositories.registry.ts";
import { insightTrpcTransport } from "./transport/insight.trpc.ts";

export const insightProcessModule = defineProcessModule("insight")
  .withRepositories(insightRepositories)
  .withApi(InsightModule)
  .withTransports(insightTrpcTransport)
  .withEventing(insightEventing);
