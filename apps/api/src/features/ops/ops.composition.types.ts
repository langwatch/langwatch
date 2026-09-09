/** Kept separate from the composition so importing the app type never pulls in adapters. */
import type { OpsApp } from "@langwatch/ops-server";

/** The operator application this process reads through. */
export type ComposedOpsFeature = Readonly<{
  /** The `ctx.app.ops` slice, which other surfaces' staff checks read. */
  app: OpsApp;
}>;
