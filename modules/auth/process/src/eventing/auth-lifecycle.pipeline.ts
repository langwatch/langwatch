import type { AuthApi } from "@langwatch/auth-contract";
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

import type { AuthModule } from "../app/auth.app.ts";
import type { AuthRepositories } from "../repositories/auth.repositories.ts";
import {
  RecordSessionStartedCommand,
  RecordSignedUpCommand,
  RecordSsoAutoAddedCommand,
} from "./auth-lifecycle.commands.ts";
import {
  AUTH_LIFECYCLE_PIPELINE_NAME,
  AUTH_USER_AGGREGATE_TYPE,
  sessionStartedEventSchema,
  signedUpEventSchema,
  ssoAutoAddedEventSchema,
} from "./auth-lifecycle.events.ts";

function lifecycleCommands() {
  return definePipeline({
    name: AUTH_LIFECYCLE_PIPELINE_NAME,
    aggregate: defineAggregate({ type: AUTH_USER_AGGREGATE_TYPE }),
  })
    .withEvents([sessionStartedEventSchema, ssoAutoAddedEventSchema, signedUpEventSchema])
    .withCommand("recordSessionStarted", RecordSessionStartedCommand)
    .withCommand("recordSsoAutoAdded", RecordSsoAutoAddedCommand)
    .withCommand("recordSignedUp", RecordSignedUpCommand);
}

export type AuthLifecycleDefinition = ReturnType<ReturnType<typeof lifecycleCommands>["build"]>;

const memberDisabledKeyOf = organizationMemberDisabledEventDataSchema.pick({
  userId: true,
  occurredAt: true,
});

/**
 * auth_lifecycle records; peers (nurturing) react to its events from their own side (§9). A seat
 * organization took away ends the person's sessions here (R7, D-A1U-6); user's former lane drains
 * through the alias. Spec: modules/auth/specs/browser-session.feature
 */
export function buildAuthLifecyclePipeline(deps: {
  sessions: Pick<AuthApi, "revokeAllBrowserSessions">;
}): AuthLifecycleDefinition {
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
      .withLaneAliases([
        {
          from: "global:subscriber:user_lifecycle.revokeDisabledMemberSessions",
          to: { jobType: "subscriber", lane: "revokeDisabledMemberSessions" },
          removeAfter: "3.21.0",
        },
      ])
      .build()
  );
}

export const authLifecycleEventing = defineEventingModule({
  pipeline: AUTH_LIFECYCLE_PIPELINE_NAME,
  build: ({ app }: EventingSetup<AuthRepositories, AuthModule>) => app.lifecyclePipeline(),
  connect: ({ app, commands }) => app.connectLifecycle(commands),
});
