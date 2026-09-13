/**
 * AuthZ's event sourcing: the grants pipeline every membership and role change
 * is written through.
 *
 * The app builds the definition and this declaration registers it, which is
 * the only order that works — the dispatcher the app holds needs the senders
 * that registration answers with, and registration needs the definition the
 * app produced. `build` therefore hands back what the app already made rather
 * than constructing a second one: a forked definition would be two
 * descriptions of one persisted event stream.
 *
 * Registration is passive on an api. That process starts no consumer loop and
 * owns no event log; it enqueues commands and the worker appends their events
 * and folds their projections, which is what makes the split location
 * independent rather than a second writer racing the first.
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
