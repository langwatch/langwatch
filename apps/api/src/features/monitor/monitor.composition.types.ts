/** Kept separate from the composition so importing the router/app type never pulls in the boot graph. */
import type { MonitorApi } from "@langwatch/monitor-contract";
import type { ApiTrpcFeatureMount } from "../../api.application.ts";
import type { createMonitorTrpcRouter } from "./monitor-trpc.mount.ts";

/** The namespace and the `ctx.app.monitors` slice the REST family reads. */
export type ComposedMonitorFeature = Readonly<{
  routers(mount: ApiTrpcFeatureMount): Readonly<{
    monitors: ReturnType<typeof createMonitorTrpcRouter>;
  }>;
  app: MonitorApi;
  restServices: Readonly<{ monitors: () => MonitorApi }>;
}>;
