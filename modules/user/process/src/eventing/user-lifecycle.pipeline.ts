import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
} from "@langwatch/eventing";
import { USER_AGGREGATE_TYPE, USER_LIFECYCLE_PIPELINE_NAME } from "@langwatch/user-contract";

import type { UserModule } from "../app/user.app.ts";
import type { UserRepositories } from "../repositories/user.repositories.ts";
import {
  RecordUserDeactivatedCommand,
  RecordUserReactivatedCommand,
  RecordUserRegisteredCommand,
} from "./user-lifecycle.commands.ts";
import {
  userDeactivatedEventSchema,
  userReactivatedEventSchema,
  userRegisteredEventSchema,
} from "./user-lifecycle.events.ts";

function lifecycleCommands() {
  return definePipeline({
    name: USER_LIFECYCLE_PIPELINE_NAME,
    aggregate: defineAggregate({ type: USER_AGGREGATE_TYPE }),
  })
    .withEvents([userDeactivatedEventSchema, userReactivatedEventSchema, userRegisteredEventSchema])
    .withCommand("recordUserDeactivated", RecordUserDeactivatedCommand)
    .withCommand("recordUserReactivated", RecordUserReactivatedCommand)
    .withCommand("recordUserRegistered", RecordUserRegisteredCommand);
}

export type UserLifecycleDefinition = ReturnType<ReturnType<typeof lifecycleCommands>["build"]>;

/** user_lifecycle: user records its account's facts; peers react from their own side (§9). */
export function buildUserLifecyclePipeline(): UserLifecycleDefinition {
  return lifecycleCommands().build();
}

export const userLifecycleEventing = defineEventingModule({
  pipeline: USER_LIFECYCLE_PIPELINE_NAME,
  build: (_setup: EventingSetup<UserRepositories, UserModule>) => buildUserLifecyclePipeline(),
  connect: ({ app, commands }) => app.connectLifecycle(commands),
});
