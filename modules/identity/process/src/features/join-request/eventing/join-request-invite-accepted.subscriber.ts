/**
 * Accepting an invitation withdraws the same person's open request, from identity's side (§9,
 * R7): organization records the acceptance and holds no identity peer for it.
 * Spec: specs/identity/join-requests.feature
 */
import type { PeerSubscriberDefinition } from "@langwatch/eventing";
import type { JoinRequestsApi } from "@langwatch/identity-contract";
import {
  INVITE_ACCEPTED_EVENT_TYPE,
  inviteAcceptedEventDataSchema,
} from "@langwatch/organization-contract";

/** The peer subscriber's name; its lane is `<host pipeline>.<this>`. */
export const JOIN_REQUEST_INVITE_ACCEPTED_SUBSCRIBER_NAME = "joinRequestInviteAccepted" as const;

const acceptedInviteOf = inviteAcceptedEventDataSchema.pick({ inviteId: true });

/** One acceptance withdraws at most one open request; a redelivery finds none left to withdraw. */
export function joinRequestInviteAcceptedSubscriber({
  joinRequests,
}: {
  joinRequests: () => Pick<JoinRequestsApi, "withdrawOnInvitationAccepted">;
}): PeerSubscriberDefinition<typeof inviteAcceptedEventDataSchema> {
  return {
    eventType: INVITE_ACCEPTED_EVENT_TYPE,
    data: inviteAcceptedEventDataSchema,
    options: {
      deduplication: {
        makeId: (event) =>
          `identity-invite-accepted:${event.tenantId}:${acceptedInviteOf.parse(event.data).inviteId}`,
        ttlMs: 60_000,
      },
    },
    handle: ({ userId, organizationId }) =>
      joinRequests().withdrawOnInvitationAccepted({ userId, organizationId }),
  };
}
