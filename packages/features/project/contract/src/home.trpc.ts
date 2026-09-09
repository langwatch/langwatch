/**
 * The `home.*` namespace: one procedure, the recent-items strip. Its answer is
 * "what has happened in this project", which is why the project owns it.
 * Onboarding status is `integrationsChecks.getCheckStatus`, not this.
 */
import { defineTrpcContract } from "@langwatch/api/contract";

import { recentItemsInputSchema } from "./project-trpc.schemas.ts";
import { recentItemSchema } from "./project.responses.ts";

export const homeTrpc = defineTrpcContract("home")
  .query("getRecentItems")
  .withInput(recentItemsInputSchema)
  .withOutput(recentItemSchema.array())
  .build();
