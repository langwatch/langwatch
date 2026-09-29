import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
} from "@langwatch/eventing";

import type { AuthApp } from "../app/auth.app.ts";
import type { AuthRepositories } from "../repositories/auth.repositories.ts";
import {
  type AuthLifecycleNurturingDeps,
  createAuthLifecycleNurturingSubscriber,
} from "./auth-lifecycle-nurturing.subscriber.ts";
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

/** auth_lifecycle: the api only records; the worker also tells nurturing (§9). */
export function buildAuthLifecyclePipeline(input: {
  nurturing?: AuthLifecycleNurturingDeps;
}): AuthLifecycleDefinition {
  const nurturing = input.nurturing;
  if (!nurturing) return lifecycleCommands().build();
  return lifecycleCommands()
    .withEventSubscriber(
      "authLifecycleNurturing",
      createAuthLifecycleNurturingSubscriber(nurturing),
    )
    .build();
}

export const authLifecycleEventing = defineEventingModule({
  pipeline: AUTH_LIFECYCLE_PIPELINE_NAME,
  build: ({ app, participation }: EventingSetup<AuthRepositories, AuthApp>) =>
    app.lifecyclePipeline({ participation }),
  connect: ({ app, commands }) => app.connectLifecycle(commands),
});
