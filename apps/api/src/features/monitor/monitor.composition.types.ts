/** Kept separate from the composition so importing the router/app type never pulls in adapters. */
import type { MonitorApp } from "@langwatch/monitor-server";
import type { ApiTrpcFeatureMount } from "../../api.application";
import type { createMonitorTrpcRouter } from "./monitor-trpc.mount";

/** The namespace and the `ctx.app.monitors` slice the REST family reads. */
export type ComposedMonitorFeature = Readonly<{
  router(mount: ApiTrpcFeatureMount): ReturnType<typeof createMonitorTrpcRouter>;
  app: MonitorApp;
}>;
