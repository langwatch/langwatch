import { defineServerModule } from "@langwatch/runtime-composition";
import { MonitorApp } from "./app/monitor.app.ts";
import { monitorRepositories } from "./repositories/monitor-repositories.registry.ts";
import { createMonitorsRest } from "./transport/monitor.rest.ts";
import { monitorTrpcTransport } from "./transport/monitor.trpc.ts";

export const monitorServer = defineServerModule("monitor")
  .withRepositories(monitorRepositories)
  .withApp(MonitorApp)
  .withTransports(createMonitorsRest(), monitorTrpcTransport)
  .build();
