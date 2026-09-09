/** Kept separate from the composition so importing the router/app type never pulls in adapters. */
import type { ProjectApi } from "@langwatch/project-contract";

/** The `ctx.app.projects` slice. The tRPC namespace is not here: its transport
 * is unconverted. */
export type ComposedProjectFeature = Readonly<{
  /** The Project API boundary shared with other namespaces. */
  app: ProjectApi;
}>;
