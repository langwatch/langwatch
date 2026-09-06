/**
 * ComposedMonitorFeature, apart from the composition that builds it.
 *
 * The record type names this feature's application and its router; the
 * composition beside it opens repositories, adapters and byte stores. Every
 * program that only names `AppRouter` reaches this record, so the two live in
 * separate modules and the type's module imports no adapter.
 */
import type { MonitorApp } from "@langwatch/monitor-server";
import type { ApiTrpcFeatureMount } from "../../api.application";
import type { createMonitorTrpcRouter } from "./monitor-trpc.mount";

/** The namespace and the `ctx.app.monitors` slice the REST family reads. */
export type ComposedMonitorFeature = Readonly<{
  router(mount: ApiTrpcFeatureMount): ReturnType<typeof createMonitorTrpcRouter>;
  app: MonitorApp;
}>;
