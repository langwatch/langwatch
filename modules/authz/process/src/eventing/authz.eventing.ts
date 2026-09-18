/**
 * Grants pipeline for membership and role changes. App builds definition; this
 * registers senders. Passive on API; worker appends and folds.
 */
import { defineEventingModule, type EventingSetup } from "@langwatch/eventing";

import type { AuthzApp } from "../app/authz.app.ts";
import type { AuthzRepositories } from "../repositories/authz.repositories.ts";
import { AUTHZ_GRANT_PIPELINE_NAME } from "./authz-grant.pipeline.ts";

export const authzEventing = defineEventingModule({
  pipeline: AUTHZ_GRANT_PIPELINE_NAME,
  build: ({ app }: EventingSetup<AuthzRepositories, AuthzApp>) => app.eventingPipeline(),
  connect: ({ app, commands }) => app.connectCommands(commands),
});
