/**
 * The `integrationsChecks.*` namespace: one procedure, how far a project has
 * been set up. The evidence belongs to nine other verticals, so the rollup
 * arrives already counted and only its shape is declared here.
 */
import { defineTrpcContract } from "@langwatch/api/contract";

import { projectScopeSchema } from "./project-trpc.schemas.ts";
import { integrationsCheckStatusSchema } from "./project.responses.ts";

export const integrationsChecksTrpc = defineTrpcContract("integrationsChecks")
  .query("getCheckStatus")
  .withInput(projectScopeSchema)
  .withOutput(integrationsCheckStatusSchema)
  .build();
