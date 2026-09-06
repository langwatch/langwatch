/**
 * ComposedProjectFeature, apart from the composition that builds it.
 *
 * The record type names this feature's application and its router; the
 * composition beside it opens repositories, adapters and byte stores. Every
 * program that only names `AppRouter` reaches this record, so the two live in
 * separate modules and the type's module imports no adapter.
 */
import type { ProjectApp } from "@langwatch/project-server";
import type { ApiTrpcFeatureMount } from "../../api.application";
import type { createProjectTrpcRouter } from "./project-trpc.mount";

/** The one namespace this feature mounts, and the `ctx.app.projects` slice. */
export type ComposedProjectFeature = Readonly<{
  router(mount: ApiTrpcFeatureMount): ReturnType<typeof createProjectTrpcRouter>;
  /** For `ctx.app.projects`, which several other namespaces read as well. */
  app: ProjectApp;
}>;
