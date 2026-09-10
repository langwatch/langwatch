/** Kept separate from the composition so importing the router/app type never pulls in adapters. */
import type { LangyApp } from "@langwatch/langy-server";

import type { ApiTrpcContext, ApiTrpcFeatureMount } from "../../api.application.ts";
import type { createLangySetupSkillsTrpcRouters } from "./setup-skills-trpc.mount.ts";

/** The Langy application, and `setupSkills.*`. `langy.*` and `langyEgress.*`
 * are not here yet: their transport is unconverted. */
export type ComposedLangyFeature = Readonly<{
  /** The `ctx.app.langy` slice both Langy doors read. */
  app: LangyApp;
  routers(
    mount: ApiTrpcFeatureMount,
  ): ReturnType<typeof createLangySetupSkillsTrpcRouters<ApiTrpcContext>>;
}>;
