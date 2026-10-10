/**
 * @vitest-environment node
 * @unit
 * @see modules/identity/specs/join-request-lifecycle.feature
 */
import { createTenantId, type Event } from "@langwatch/eventing";
import type { JoinRequestsApi } from "@langwatch/identity-contract";
import {
  MEMBERS_INVITED_EVENT_TYPE,
  type MembersInvitedEventData,
} from "@langwatch/organization-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { joinRequestMembersInvitedSubscriber } from "../join-request-members-invited.subscriber.ts";

const INVITED: MembersInvitedEventData = {
  tenantId: "organization-1",
  organizationId: "organization-1",
  userId: "user-ana",
  occurredAt: 1_500,
  inviteIds: ["invite-sam", "invite-kim"],
  roles: ["MEMBER", "MEMBER"],
  teamMemberCount: 3,
  invitees: [{ inviteId: "invite-sam", userId: "user-sam" }],
};

function invitedEvent({ id }: { id: string }): Event {
  return {
    id,
    aggregateId: INVITED.organizationId,
    aggregateType: "organization",
    tenantId: createTenantId(INVITED.tenantId),
    createdAt: INVITED.occurredAt,
    occurredAt: INVITED.occurredAt,
    type: MEMBERS_INVITED_EVENT_TYPE,
    version: "2025-01-01",
    data: INVITED,
  };
}

/** One open request for sam at the organization; resolving it twice resolves it once. */
function ledgerWithOpenRequest() {
  const open = new Set([`user-sam:${INVITED.organizationId}`]);
  const resolved: string[] = [];
  return {
    resolved,
    joinRequests: createApiFixture<JoinRequestsApi>({
      resolveByInvitation: async (input) => {
        if (!open.delete(`${input.userId}:${input.organizationId}`)) return;
        resolved.push(`${input.userId}:${input.organizationId}:${input.inviteId}`);
      },
    }),
  };
}

function subscriberOver(ledger: ReturnType<typeof ledgerWithOpenRequest>) {
  return joinRequestMembersInvitedSubscriber({ joinRequests: () => ledger.joinRequests });
}

function deduplicationIdOf(event: Event): string {
  const strategy = subscriberOver(ledgerWithOpenRequest()).options?.deduplication;
  if (strategy === undefined || strategy === "aggregate") {
    throw new Error("the peer subscriber declares its own deduplication id");
  }
  return strategy.makeId(event);
}

const CONTEXT = {
  tenantId: INVITED.tenantId,
  aggregateId: INVITED.organizationId,
  occurredAt: INVITED.occurredAt,
  createdAt: INVITED.occurredAt,
  eventId: "event-1",
};

describe("given organization records an invitation batch", () => {
  describe("when identity's peer subscriber handles the fact", () => {
    /** @scenario Identity answers a pending request from organization's invitation fact */
    it("resolves the named invitee's open request by that invitation", async () => {
      const ledger = ledgerWithOpenRequest();

      await subscriberOver(ledger).handle(INVITED, CONTEXT);

      expect(ledger.resolved).toEqual(["user-sam:organization-1:invite-sam"]);
    });
  });

  describe("when the fact names no invitees", () => {
    /** @scenario A batch fact that names no invitees resolves nothing */
    it("leaves every request open", async () => {
      const ledger = ledgerWithOpenRequest();
      const { invitees: _omitted, ...withoutInvitees } = INVITED;

      await subscriberOver(ledger).handle(withoutInvitees, CONTEXT);

      expect(ledger.resolved).toEqual([]);
    });
  });

  describe("when the same fact is delivered again", () => {
    it("deduplicates the two deliveries on one id keyed by the batch", () => {
      expect(deduplicationIdOf(invitedEvent({ id: "event-1" }))).toBe(
        deduplicationIdOf(invitedEvent({ id: "event-2" })),
      );
      expect(deduplicationIdOf(invitedEvent({ id: "event-1" }))).toBe(
        "identity-members-invited:organization-1:invite-sam,invite-kim",
      );
    });

    /** @scenario A redelivered invitation batch resolves the pending request once */
    it("resolves the request once and leaves the redelivery nothing to do", async () => {
      const ledger = ledgerWithOpenRequest();
      const subscriber = subscriberOver(ledger);

      await subscriber.handle(INVITED, CONTEXT);
      await subscriber.handle(INVITED, { ...CONTEXT, eventId: "event-2" });

      expect(ledger.resolved).toEqual(["user-sam:organization-1:invite-sam"]);
    });
  });
});
