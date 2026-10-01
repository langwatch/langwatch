import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
} from "@langwatch/eventing";

import type { AuthApp } from "../app/auth.app.ts";
import type { AuthRepositories } from "../repositories/auth.repositories.ts";
import {
  RecordSessionStartedCommand,
  RecordSsoAutoAddedCommand,
} from "./auth-lifecycle.commands.ts";
import {
  AUTH_LIFECYCLE_PIPELINE_NAME,
  AUTH_USER_AGGREGATE_TYPE,
  sessionStartedEventSchema,
  ssoAutoAddedEventSchema,
} from "./auth-lifecycle.events.ts";

function lifecycleCommands() {
  return definePipeline({
    name: AUTH_LIFECYCLE_PIPELINE_NAME,
    aggregate: defineAggregate({ type: AUTH_USER_AGGREGATE_TYPE }),
  })
    .withEvents([sessionStartedEventSchema, ssoAutoAddedEventSchema])
    .withCommand("recordSessionStarted", RecordSessionStartedCommand)
    .withCommand("recordSsoAutoAdded", RecordSsoAutoAddedCommand);
}

export type AuthLifecycleDefinition = ReturnType<ReturnType<typeof lifecycleCommands>["build"]>;

/** auth_lifecycle records; peers (nurturing) react to its events from their own side (§9). */
export function buildAuthLifecyclePipeline(): AuthLifecycleDefinition {
  return lifecycleCommands().build();
}

export const authLifecycleEventing = defineEventingModule({
  pipeline: AUTH_LIFECYCLE_PIPELINE_NAME,
  build: ({ app }: EventingSetup<AuthRepositories, AuthApp>) => app.lifecyclePipeline(),
  connect: ({ app, commands }) => app.connectLifecycle(commands),
});
