import { defineServerModule } from "@langwatch/runtime-composition";
import { MonitorApp } from "./app/monitor.app.ts";
import { monitorRepositories } from "./repositories/monitor-repositories.registry.ts";
import { monitorTrpcTransport } from "./transport/monitor.trpc.ts";

export const monitorServer = defineServerModule("monitor")
  .withRepositories(monitorRepositories)
  .withApp(MonitorApp)
  .withTransports(monitorTrpcTransport)
  .build();
