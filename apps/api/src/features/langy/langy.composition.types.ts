/** Kept separate from the composition so importing the router/app type never pulls in adapters. */
import type { LangyApp } from "@langwatch/langy-server";

/** The Langy application. `langy.*` and `langyEgress.*` are not here: their
 * transport is unconverted. */
export type ComposedLangyFeature = Readonly<{
  /** The `ctx.app.langy` slice both Langy doors read. */
  app: LangyApp;
}>;
