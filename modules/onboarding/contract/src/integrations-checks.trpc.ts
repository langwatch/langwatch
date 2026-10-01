/**
 * The `integrationsChecks.*` namespace: one procedure, how far a project has
 * been set up. Main's onboarding checks; the evidence is counted by its owners.
 */
import { defineTrpcContract } from "@langwatch/kernel/contract";
import { z } from "zod";

import { integrationsCheckStatusSchema } from "./onboarding.responses.ts";

export const integrationsChecksTrpc = defineTrpcContract("integrationsChecks")
  .query("getCheckStatus")
  .withInput(z.object({ projectId: z.string() }))
  .withOutput(integrationsCheckStatusSchema)
  .build();
