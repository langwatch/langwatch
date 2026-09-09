/** Kept separate from the composition so importing the router/app type never pulls in adapters. */
import type { PromptApp } from "@langwatch/prompt-server";

/** The `ctx.app.prompts` slice two other doors read. The tRPC namespace is not
 * here: its transport is unconverted. */
export type ComposedPromptFeature = Readonly<{
  /** For `ctx.app.prompts`. */
  app: PromptApp;
}>;
