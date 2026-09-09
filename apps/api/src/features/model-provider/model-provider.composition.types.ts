/** Kept separate from the composition so importing the router/app type never pulls in adapters. */
import type { ModelProviderApp } from "@langwatch/model-provider-server";

/** The `ctx.app.modelProviders` slice. The three tRPC namespaces are not here:
 * their transports are unconverted. */
export type ComposedModelProviderFeature = Readonly<{
  /** For `ctx.app.modelProviders`. */
  app: ModelProviderApp;
}>;
