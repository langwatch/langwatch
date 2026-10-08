import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type ProcessStore,
} from "@langwatch/eventing";
import {
  ORGANIZATION_MEMBER_DISABLED_EVENT_TYPE,
  organizationMemberDisabledEventDataSchema,
} from "@langwatch/organization-contract";
import {
  USER_AGGREGATE_TYPE,
  USER_LIFECYCLE_PIPELINE_NAME,
  type UserApi,
  userCreatedEventDataSchema,
  userLifecycleEventDataSchema,
  userRegisteredEventDataSchema,
} from "@langwatch/user-contract";

import type { UserModule } from "../app/user.app.ts";
import type { UserRepositories } from "../repositories/user.repositories.ts";
import {
  USER_FACTS_PROCESS_NAME,
  USER_FACTS_PRUNE_INTENT,
  USER_FACTS_RECORD_CREATED_INTENT,
  USER_FACTS_RECORD_ERASED_INTENT,
  USER_FACTS_RECORD_REGISTERED_INTENT,
  type UserFactIntent,
} from "../rules/user-lifecycle-outbox.rules.ts";
import {
  USER_FACTS_INITIAL_STATE,
  USER_FACTS_MAX_ATTEMPTS,
  USER_FACTS_PRUNE_INTERVAL_MS,
  pruneUserFactIntents,
  userFactsPruneSchema,
  userFactsPruneWake,
  userFactsStateSchema,
} from "./user-lifecycle-facts.process.ts";
import {
  RecordUserCreatedCommand,
  RecordUserDeactivatedCommand,
  RecordUserErasedCommand,
  RecordUserReactivatedCommand,
  RecordUserRegisteredCommand,
} from "./user-lifecycle.commands.ts";
import {
  userCreatedEventSchema,
  userDeactivatedEventSchema,
  userErasedEventSchema,
  userReactivatedEventSchema,
  userRegisteredEventSchema,
} from "./user-lifecycle.events.ts";

type UserFactsDeps = Readonly<{
  /** Records one committed fact on this pipeline; throws while unconnected, so it retries. */
  record: (intent: UserFactIntent) => Promise<void>;
  retention: Pick<ProcessStore, "deleteDispatchedBefore">;
}>;

function lifecycleCommands(facts: UserFactsDeps) {
  return definePipeline({
    name: USER_LIFECYCLE_PIPELINE_NAME,
    aggregate: defineAggregate({ type: USER_AGGREGATE_TYPE }),
  })
    .withEvents([
      userDeactivatedEventSchema,
      userReactivatedEventSchema,
      userRegisteredEventSchema,
      userCreatedEventSchema,
      userErasedEventSchema,
    ])
    .withCommand("recordUserDeactivated", RecordUserDeactivatedCommand)
    .withCommand("recordUserReactivated", RecordUserReactivatedCommand)
    .withCommand("recordUserRegistered", RecordUserRegisteredCommand)
    .withCommand("recordUserCreated", RecordUserCreatedCommand)
    .withCommand("recordUserErased", RecordUserErasedCommand)
    .withProcessManager(USER_FACTS_PROCESS_NAME, (pm) =>
      pm
        .state(userFactsStateSchema, USER_FACTS_INITIAL_STATE)
        .intent(USER_FACTS_RECORD_CREATED_INTENT, userCreatedEventDataSchema, (data) =>
          facts.record({ type: USER_FACTS_RECORD_CREATED_INTENT, data }),
        )
        .intent(USER_FACTS_RECORD_REGISTERED_INTENT, userRegisteredEventDataSchema, (data) =>
          facts.record({ type: USER_FACTS_RECORD_REGISTERED_INTENT, data }),
        )
        .intent(USER_FACTS_RECORD_ERASED_INTENT, userLifecycleEventDataSchema, (data) =>
          facts.record({ type: USER_FACTS_RECORD_ERASED_INTENT, data }),
        )
        .intent(
          USER_FACTS_PRUNE_INTENT,
          userFactsPruneSchema,
          pruneUserFactIntents(facts.retention),
        )
        .schedule({ everyMs: USER_FACTS_PRUNE_INTERVAL_MS })
        .onWake(userFactsPruneWake)
        .outbox({ maxAttempts: USER_FACTS_MAX_ATTEMPTS }),
    );
}

type UserLifecycleDefinition = ReturnType<ReturnType<typeof lifecycleCommands>["build"]>;

const memberDisabledKeyOf = organizationMemberDisabledEventDataSchema.pick({
  userId: true,
  occurredAt: true,
});

/**
 * user_lifecycle: user records its account's facts; peers react from their own side (§9). A mint's,
 * registration's and erasure's facts arrive through its fact outbox (round 35). A seat organization
 * took away ends the person's sessions here (R7). Spec: modules/user/specs/user.feature
 */
export function buildUserLifecyclePipeline(deps: {
  sessions: Pick<UserApi, "revokeAllBrowserSessions">;
  facts: UserFactsDeps;
}): UserLifecycleDefinition {
  return (
    lifecycleCommands(deps.facts)
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
  build: ({ app, processStore }: EventingSetup<UserRepositories, UserModule>) =>
    buildUserLifecyclePipeline({
      sessions: { revokeAllBrowserSessions: (input) => app.revokeAllBrowserSessions(input) },
      facts: {
        record: (intent) => app.recordLifecycleFact(intent),
        retention: processStore,
      },
    }),
  connect: ({ app, commands }) => app.connectLifecycle(commands),
});
