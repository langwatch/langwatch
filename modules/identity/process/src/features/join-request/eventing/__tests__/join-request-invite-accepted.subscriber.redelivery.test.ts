/**
 * @vitest-environment node
 * @unit
 * @see specs/identity/join-requests.feature
 */
import { createTenantId, type Event } from "@langwatch/eventing";
import type { JoinRequestsApi } from "@langwatch/identity-contract";
import {
  INVITE_ACCEPTED_EVENT_TYPE,
  type InviteAcceptedEventData,
} from "@langwatch/organization-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { joinRequestInviteAcceptedSubscriber } from "../join-request-invite-accepted.subscriber.ts";

const ACCEPTED: InviteAcceptedEventData = {
  tenantId: "organization-1",
  organizationId: "organization-1",
  userId: "user-sam",
  occurredAt: 1_500,
  inviteId: "invite-1",
  organizationName: "Acme",
};

function acceptedEvent({ id }: { id: string }): Event {
  return {
    id,
    aggregateId: ACCEPTED.organizationId,
    aggregateType: "organization",
    tenantId: createTenantId(ACCEPTED.tenantId),
    createdAt: ACCEPTED.occurredAt,
    occurredAt: ACCEPTED.occurredAt,
    type: INVITE_ACCEPTED_EVENT_TYPE,
    version: "2025-01-01",
    data: ACCEPTED,
  };
}

/** One open request for sam at acme; withdrawing it twice leaves it withdrawn once. */
function ledgerWithOpenRequest() {
  const open = new Set([`${ACCEPTED.userId}:${ACCEPTED.organizationId}`]);
  const withdrawn: string[] = [];
  return {
    withdrawn,
    joinRequests: createApiFixture<JoinRequestsApi>({
      withdrawOnInvitationAccepted: async (input) => {
        const key = `${input.userId}:${input.organizationId}`;
        if (!open.delete(key)) return;
        withdrawn.push(key);
      },
    }),
  };
}

function deduplicationIdOf(event: Event): string {
  const strategy = joinRequestInviteAcceptedSubscriber({
    joinRequests: () => ledgerWithOpenRequest().joinRequests,
  }).options?.deduplication;
  if (strategy === undefined || strategy === "aggregate") {
    throw new Error("the peer subscriber declares its own deduplication id");
  }
  return strategy.makeId(event);
}

const CONTEXT = {
  tenantId: ACCEPTED.tenantId,
  aggregateId: ACCEPTED.organizationId,
  occurredAt: ACCEPTED.occurredAt,
  createdAt: ACCEPTED.occurredAt,
  eventId: "event-1",
};

describe("given organization records an invitation as accepted", () => {
  describe("when identity's peer subscriber handles the fact", () => {
    /** @scenario Identity withdraws the pending request from organization's acceptance fact */
    it("withdraws the same person's open request for that organization", async () => {
      const ledger = ledgerWithOpenRequest();
      const subscriber = joinRequestInviteAcceptedSubscriber({
        joinRequests: () => ledger.joinRequests,
      });

      await subscriber.handle(ACCEPTED, CONTEXT);

      expect(ledger.withdrawn).toEqual(["user-sam:organization-1"]);
    });
  });

  describe("when the same fact is delivered again", () => {
    it("deduplicates the two deliveries on one id keyed by the invitation", () => {
      expect(deduplicationIdOf(acceptedEvent({ id: "event-1" }))).toBe(
        deduplicationIdOf(acceptedEvent({ id: "event-2" })),
      );
      expect(deduplicationIdOf(acceptedEvent({ id: "event-1" }))).toBe(
        "identity-invite-accepted:organization-1:invite-1",
      );
    });

    /** @scenario A redelivered acceptance withdraws the pending request once */
    it("withdraws the request once and leaves the redelivery nothing to do", async () => {
      const ledger = ledgerWithOpenRequest();
      const subscriber = joinRequestInviteAcceptedSubscriber({
        joinRequests: () => ledger.joinRequests,
      });

      await subscriber.handle(ACCEPTED, CONTEXT);
      await subscriber.handle(ACCEPTED, { ...CONTEXT, eventId: "event-2" });

      expect(ledger.withdrawn).toEqual(["user-sam:organization-1"]);
    });
  });
});
