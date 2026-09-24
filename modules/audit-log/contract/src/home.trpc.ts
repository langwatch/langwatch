/** The `home.*` namespace: the recent-items strip, read from the caller's own audit trail. */
import { defineTrpcContract } from "@langwatch/api/contract";

import { recentItemSchema, recentItemsInputSchema } from "./recent-items.ts";

export const homeTrpc = defineTrpcContract("home")
  .query("getRecentItems")
  .withInput(recentItemsInputSchema)
  .withOutput(recentItemSchema.array())
  .build();
