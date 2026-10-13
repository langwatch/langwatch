/**
 * Sending an invitation answers the same person's open request, from identity's side (§9, R7):
 * organization names the invitees who hold an account on its batch fact and holds no identity peer.
 * Spec: specs/identity/join-requests.feature
 */
import type { PeerSubscriberDefinition } from "@langwatch/eventing";
import type { JoinRequestsApi } from "@langwatch/identity-contract";
import {
  MEMBERS_INVITED_EVENT_TYPE,
  membersInvitedEventDataSchema,
} from "@langwatch/organization-contract";

/** The peer subscriber's name; its lane is `<host pipeline>.<this>`. */
export const JOIN_REQUEST_MEMBERS_INVITED_SUBSCRIBER_NAME = "joinRequestMembersInvited" as const;

const invitedBatchOf = membersInvitedEventDataSchema.pick({ inviteIds: true });

/** Each invitee's open request resolves once; a redelivery finds none left open to resolve. */
export function joinRequestMembersInvitedSubscriber({
  joinRequests,
}: {
  joinRequests: () => Pick<JoinRequestsApi, "resolveByInvitation">;
}): PeerSubscriberDefinition<typeof membersInvitedEventDataSchema> {
  return {
    eventType: MEMBERS_INVITED_EVENT_TYPE,
    data: membersInvitedEventDataSchema,
    options: {
      deduplication: {
        makeId: (event) =>
          `identity-members-invited:${event.tenantId}:${invitedBatchOf.parse(event.data).inviteIds.join(",")}`,
        ttlMs: 60_000,
      },
    },
    handle: async ({ organizationId, invitees }) => {
      for (const { inviteId, userId } of invitees ?? []) {
        await joinRequests().resolveByInvitation({ userId, organizationId, inviteId });
      }
    },
  };
}
