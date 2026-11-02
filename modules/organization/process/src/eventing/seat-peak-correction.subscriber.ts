/**
 * Organization's peer subscribers for seats moved outside its own writes (ADR-002 §6): authz,
 * user and SCIM's directory creates.
 * Spec: modules/organization/specs/seat-peak.feature
 */
import {
  AUTHZ_MEMBER_OFFBOARDED_EVENT_TYPE,
  authzMemberOffboardedEventDataSchema,
  GRANT_ATTACHED_EVENT_TYPE,
  GRANT_REVOKED_EVENT_TYPE,
  GRANT_ROLE_CHANGED_EVENT_TYPE,
  grantAttachedPayloadSchema,
  grantRevokedPayloadSchema,
  grantRoleChangedPayloadSchema,
  ROLE_DELETED_EVENT_TYPE,
  ROLE_PERMISSIONS_CHANGED_EVENT_TYPE,
  roleDeletedPayloadSchema,
  rolePermissionsChangedPayloadSchema,
} from "@langwatch/authz-contract";
import {
  SCIM_MEMBER_CREATED_EVENT_TYPE,
  scimMemberCreatedEventDataSchema,
} from "@langwatch/enterprise-scim-contract";
import type { ParsingSchema, PeerSubscriberDefinition } from "@langwatch/eventing";
import {
  USER_DEACTIVATED_EVENT_TYPE,
  USER_ERASED_EVENT_TYPE,
  USER_REACTIVATED_EVENT_TYPE,
  userErasedEventDataSchema,
  userLifecycleEventDataSchema,
} from "@langwatch/user-contract";

import type { SeatPeakCorrectionService } from "../services/seat-peak-correction.service.ts";

export type SeatPeakCorrections = Pick<
  SeatPeakCorrectionService,
  "correctMember" | "correctOrganization" | "correctInvitations" | "correctAccount"
>;

type PeerSubscribing = {
  withPeerSubscriber<Data extends ParsingSchema>(
    name: string,
    subscriber: PeerSubscriberDefinition<Data>,
  ): unknown;
};

/** authz's ledger projects a binding after its event; the wait lets the read see it. */
const AFTER_BINDING_PROJECTED_MS = 2_000;

/** A burst of one organization's grant changes is corrected by one read of its seats. */
const organizationWide = {
  delay: AFTER_BINDING_PROJECTED_MS,
  deduplication: {
    makeId: (event: { tenantId: string }) => `seat-peak-view-only-line:${event.tenantId}`,
    ttlMs: 5_000,
    extend: false,
  },
};

/**
 * Adds the corrections to organization_seat_peak; every handler is idempotent by event id, reads
 * the live seat and dates its change at the source event (ADR-002 §6).
 */
export function withSeatCorrections<Pipeline extends PeerSubscribing>({
  pipeline,
  corrections,
}: {
  pipeline: Pipeline;
  corrections: SeatPeakCorrections;
}): Pipeline {
  const acrossViewOnlyLine = (
    organizationId: string,
    { eventId, occurredAt }: { eventId: string; occurredAt: number },
  ) =>
    corrections.correctOrganization({
      organizationId,
      source: { eventId, occurredAt, cause: "custom_role_changed" },
    });

  pipeline.withPeerSubscriber("seatPeakTeamGrantAttached", {
    eventType: GRANT_ATTACHED_EVENT_TYPE,
    data: grantAttachedPayloadSchema,
    options: {
      delay: AFTER_BINDING_PROJECTED_MS,
      enqueue: { filter: (grant) => isTeamGrantToAPerson(grant) },
    },
    handle: (grant, { tenantId, eventId, occurredAt }) =>
      isTeamGrantToAPerson(grant) && grant.principal.id !== null
        ? corrections.correctMember({
            organizationId: tenantId,
            userId: grant.principal.id,
            source: { eventId, occurredAt, cause: "custom_role_changed" },
          })
        : Promise.resolve(),
  });
  // These name only a grant or a role, not who holds it: the organization's members are read.
  pipeline.withPeerSubscriber("seatPeakGrantRoleChanged", {
    eventType: GRANT_ROLE_CHANGED_EVENT_TYPE,
    data: grantRoleChangedPayloadSchema,
    options: organizationWide,
    handle: (_grant, context) => acrossViewOnlyLine(context.tenantId, context),
  });
  pipeline.withPeerSubscriber("seatPeakGrantRevoked", {
    eventType: GRANT_REVOKED_EVENT_TYPE,
    data: grantRevokedPayloadSchema,
    options: organizationWide,
    handle: (_grant, context) => acrossViewOnlyLine(context.tenantId, context),
  });
  pipeline.withPeerSubscriber("seatPeakRolePermissionsChanged", {
    eventType: ROLE_PERMISSIONS_CHANGED_EVENT_TYPE,
    data: rolePermissionsChangedPayloadSchema,
    options: organizationWide,
    handle: (_role, context) => acrossViewOnlyLine(context.tenantId, context),
  });
  pipeline.withPeerSubscriber("seatPeakRoleDeleted", {
    eventType: ROLE_DELETED_EVENT_TYPE,
    data: roleDeletedPayloadSchema,
    options: organizationWide,
    handle: (_role, context) => acrossViewOnlyLine(context.tenantId, context),
  });

  pipeline.withPeerSubscriber("seatPeakAccountDeactivated", {
    eventType: USER_DEACTIVATED_EVENT_TYPE,
    data: userLifecycleEventDataSchema,
    handle: ({ userId }, { eventId, occurredAt }) =>
      corrections.correctAccount({
        userId,
        source: { eventId, occurredAt, cause: "account_deactivated" },
      }),
  });
  pipeline.withPeerSubscriber("seatPeakAccountReactivated", {
    eventType: USER_REACTIVATED_EVENT_TYPE,
    data: userLifecycleEventDataSchema,
    handle: ({ userId }, { eventId, occurredAt }) =>
      corrections.correctAccount({
        userId,
        source: { eventId, occurredAt, cause: "account_reactivated" },
      }),
  });
  // The erasure deleted the memberships, so the fact names the organizations whose seat it took.
  pipeline.withPeerSubscriber("seatPeakAccountErased", {
    eventType: USER_ERASED_EVENT_TYPE,
    data: userErasedEventDataSchema,
    handle: ({ userId, organizationIds }, { eventId, occurredAt }) =>
      corrections.correctAccount({
        userId,
        organizationIds: organizationIds ?? [],
        source: { eventId, occurredAt, cause: "removed" },
      }),
  });
  // An offboarding deletes the membership and the person's pending invitations in authz's write.
  pipeline.withPeerSubscriber("seatPeakMemberOffboarded", {
    eventType: AUTHZ_MEMBER_OFFBOARDED_EVENT_TYPE,
    data: authzMemberOffboardedEventDataSchema,
    handle: async ({ organizationId, userId }, { eventId, occurredAt }) => {
      await corrections.correctMember({
        organizationId,
        userId,
        source: { eventId, occurredAt, cause: "removed" },
      });
      await corrections.correctInvitations({
        organizationId,
        source: { eventId, occurredAt, cause: "invitation_revoked" },
      });
    },
  });
  // SCIM wrote the membership; the seat is classified here by organization's own rule.
  pipeline.withPeerSubscriber("seatPeakDirectoryMemberCreated", {
    eventType: SCIM_MEMBER_CREATED_EVENT_TYPE,
    data: scimMemberCreatedEventDataSchema,
    handle: ({ organizationId, userId, createId }, { occurredAt }) =>
      corrections.correctMember({
        organizationId,
        userId,
        source: { eventId: createId, occurredAt, cause: "directory_created" },
      }),
  });
  return pipeline;
}

function isTeamGrantToAPerson(grant: {
  principal: { type: string; id: string | null };
  scope: { type: string };
}): boolean {
  return grant.principal.type === "user" && grant.scope.type === "TEAM";
}
