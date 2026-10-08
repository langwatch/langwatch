import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
} from "@langwatch/eventing";
import {
  ORGANIZATION_MEMBER_DISABLED_EVENT_TYPE,
  organizationMemberDisabledEventDataSchema,
} from "@langwatch/organization-contract";
import {
  USER_AGGREGATE_TYPE,
  USER_LIFECYCLE_PIPELINE_NAME,
  type UserApi,
} from "@langwatch/user-contract";

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

type UserLifecycleDefinition = ReturnType<ReturnType<typeof lifecycleCommands>["build"]>;

const memberDisabledKeyOf = organizationMemberDisabledEventDataSchema.pick({
  userId: true,
  occurredAt: true,
});

/**
 * user_lifecycle: user records its account's facts; peers react from their own side (§9). A
 * seat organization took away ends the person's browser sessions here (R7), so organization
 * holds no user peer. Spec: modules/user/specs/user.feature
 */
export function buildUserLifecyclePipeline(deps: {
  sessions: Pick<UserApi, "revokeAllBrowserSessions">;
}): UserLifecycleDefinition {
  return (
    lifecycleCommands()
      // The revoke ends whatever sessions exist, so a redelivery finds none left to end.
      .withPeerSubscriber("revokeDisabledMemberSessions", {
        eventType: ORGANIZATION_MEMBER_DISABLED_EVENT_TYPE,
        data: organizationMemberDisabledEventDataSchema,
        options: {
          deduplication: {
            makeId: (event) => {
              const { userId, occurredAt } = memberDisabledKeyOf.parse(event.data);
              return `user-member-disabled:${event.tenantId}:${String(event.aggregateId)}:${userId}:${occurredAt}`;
            },
            ttlMs: 60_000,
          },
        },
        handle: ({ userId }) => deps.sessions.revokeAllBrowserSessions({ userId }),
      })
      .build()
  );
}

export const userLifecycleEventing = defineEventingModule({
  pipeline: USER_LIFECYCLE_PIPELINE_NAME,
  build: ({ app }: EventingSetup<UserRepositories, UserModule>) =>
    buildUserLifecyclePipeline({
      sessions: { revokeAllBrowserSessions: (input) => app.revokeAllBrowserSessions(input) },
    }),
  connect: ({ app, commands }) => app.connectLifecycle(commands),
});
