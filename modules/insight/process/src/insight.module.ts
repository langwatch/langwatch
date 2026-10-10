import { defineProcessModule } from "@langwatch/process";

import { InsightModule } from "./app/insight.app.ts";
import { insightDailyRunEventing } from "./eventing/insight-daily-run.pipeline.ts";
import { insightEventing } from "./eventing/insight.pipeline.ts";
import { insightRepositories } from "./repositories/insight-repositories.registry.ts";
import { InsightDailyRunRequestTask } from "./tasks/insight-daily-run-request.task.ts";
import { insightTrpcTransport } from "./transport/insight.trpc.ts";

export const insightProcessModule = defineProcessModule("insight")
  .withRepositories(insightRepositories)
  .withApi(InsightModule)
  .withTransports(insightTrpcTransport)
  .withEventing(insightEventing)
  .withEventing(insightDailyRunEventing)
  .withTasks(({ app }) => [InsightDailyRunRequestTask.create({ insights: app })]);
