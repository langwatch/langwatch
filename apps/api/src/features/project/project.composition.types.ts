/** Kept separate from the composition so importing the router/app type never pulls in adapters. */
import type { ProjectApp } from "@langwatch/project-server";
import type { ApiTrpcFeatureMount } from "../../api.application.ts";
import type { createProjectTrpcRouter } from "./project-trpc.mount.ts";

/** The one namespace this feature mounts, and the `ctx.app.projects` slice. */
export type ComposedProjectFeature = Readonly<{
  router(mount: ApiTrpcFeatureMount): ReturnType<typeof createProjectTrpcRouter>;
  /** For `ctx.app.projects`, which several other namespaces read as well. */
  app: ProjectApp;
}>;
