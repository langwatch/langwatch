/** Kept separate from the composition so importing the router/app type never pulls in adapters. */
import type { ProjectApi } from "@langwatch/project-contract";
import type { ApiTrpcContext, ApiTrpcFeatureMount } from "../../api.application.ts";
import type { createProjectTrpcRouter } from "./project-trpc.mount.ts";

/** The `project.*` namespace and the `ctx.app.projects` slice behind it. */
export type ComposedProjectFeature = Readonly<{
  router(mount: ApiTrpcFeatureMount): ReturnType<typeof createProjectTrpcRouter<ApiTrpcContext>>;
  /** The Project API boundary shared with other namespaces. */
  app: ProjectApi;
}>;
