import { defineProcessModule } from "@langwatch/process";

import { MonitorModule } from "./app/monitor.app.ts";
import { monitorEvaluatorCleanupEventing } from "./eventing/monitor-evaluator-cleanup.pipeline.ts";
import { monitorRepositories } from "./repositories/monitor-repositories.registry.ts";
import { createMonitorsRest } from "./transport/monitor.rest.ts";
import { monitorTrpcTransport } from "./transport/monitor.trpc.ts";

export const monitorProcessModule = defineProcessModule("monitor")
  .withRepositories(monitorRepositories)
  .withApi(MonitorModule)
  .withTransports(createMonitorsRest(), monitorTrpcTransport)
  .withEventing(monitorEvaluatorCleanupEventing);
