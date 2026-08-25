/** @vitest-environment node */

/**
 * What an automatic join LEAVES BEHIND (D12).
 *
 * Admitting somebody with nobody in the loop is only safe if it is visible
 * the moment it happens and still visible months later. Two things carry
 * that, and both are asserted here against the real code rather than
 * described: every admin is told straight away, and the membership lands on
 * the customer's audit page the same way an approval somebody clicked does.
 *
 * Spec: specs/identity/domain-auto-join.feature
 */
import { SYSTEM_ACTORS } from "@langwatch/actor";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sendDomainAutoJoined = vi.fn(async () => undefined);
const sendArrived = vi.fn(async () => undefined);

vi.mock("~/server/mailer/joinRequestEmails", () => ({
  sendDomainAutoJoinedEmail: (args: unknown) => sendDomainAutoJoined(args),
  sendJoinRequestApprovedEmail: vi.fn(async () => undefined),
  sendJoinRequestArrivedEmail: (args: unknown) => sendArrived(args),
  sendJoinRequestExpiredEmail: vi.fn(async () => undefined),
  sendJoinRequestRejectedEmail: vi.fn(async () => undefined),
  sendJoinRequestReminderEmail: vi.fn(async () => undefined),
}));

import { GRANT_ATTACHED_EVENT_TYPE } from "~/server/event-sourcing/pipelines/authz-grants/schemas/constants";
import {
  isAuditableGrantEvent,
  toAuthzAuditRow,
} from "~/server/event-sourcing/pipelines/authz-grants/subscribers/authzAuditTrail.subscriber";
import {
  EmailJoinRequestNotifier,
  PrismaJoinMembership,
} from "../join-request-adapters";

const ORGANIZATION_ID = "org_acme";

/** Just the reads these two adapters make, and nothing else. */
function fakePrisma() {
  return {
    organization: {
      findUnique: vi.fn(async () => ({ name: "Acme" })),
    },
    organizationUser: {
      findMany: vi.fn(async () => [
        { user: { email: "ana@acme.com" } },
        { user: { email: "ivan@acme.com" } },
      ]),
      createMany: vi.fn(async () => ({ count: 1 })),
      findUnique: vi.fn(async () => null),
    },
    user: {
      findUnique: vi.fn(async () => ({ name: "Sam", email: "sam@acme.com" })),
    },
    joinRequest: { findUnique: vi.fn(async () => ({ userId: "user_sam" })) },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("given a colleague who walked in on the domain setting", () => {
  describe("when the join happens", () => {
    /** @scenario The admins are told after the fact, straight away */
    it("tells every admin, naming who joined and what admitted them", async () => {
      const prisma = fakePrisma();
      const notifier = new EmailJoinRequestNotifier(prisma as never);

      await notifier.joinedAutomatically({
        joinRequestId: "jreq_1",
        organizationId: ORGANIZATION_ID,
        requesterUserId: "user_sam",
        domain: "acme.com",
      });

      // Every admin, not the first one: one bouncing address must not
      // silence the rest.
      expect(sendDomainAutoJoined).toHaveBeenCalledTimes(2);
      expect(sendDomainAutoJoined).toHaveBeenCalledWith(
        expect.objectContaining({
          adminEmail: "ana@acme.com",
          organizationName: "Acme",
          memberName: "Sam",
          // The domain is what admitted them, and it is what an admin needs
          // in order to change the setting that did.
          domain: "acme.com",
        }),
      );
      expect(sendDomainAutoJoined).toHaveBeenCalledWith(
        expect.objectContaining({ adminEmail: "ivan@acme.com" }),
      );
    });

    /** @scenario Every automatic join is on the customer's audit page */
    it("attaches the membership with the policy's own principal and provenance", async () => {
      const prisma = fakePrisma();
      const writer = { attachBindings: vi.fn(async () => undefined) };
      const membership = new PrismaJoinMembership(
        prisma as never,
        writer as never,
      );

      await membership.attachDefaultMembership({
        userId: "user_sam",
        organizationId: ORGANIZATION_ID,
        approvedByUserId: null,
      });

      expect(writer.attachBindings).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: ORGANIZATION_ID,
          // Nobody clicked, so the actor is the surface rather than a person
          // — and `source` is what tells an auditor which surface.
          actor: { type: "system", id: SYSTEM_ACTORS.joinRequests },
          source: "join-request",
        }),
      );
    });

    /** @scenario Every automatic join is on the customer's audit page */
    it("earns an audit row on that organization, the same one an approval earns", async () => {
      const attachedBy = (actor: {
        type: "user" | "system";
        id: string | null;
      }) => ({
        id: `evt_${actor.id ?? "policy"}`,
        type: GRANT_ATTACHED_EVENT_TYPE,
        aggregateId: ORGANIZATION_ID,
        occurredAt: 1_700_000_000_000,
        data: {
          grantId: "rb_1",
          principal: { type: "user", id: "user_sam" },
          roleKey: "MEMBER",
          scope: { type: "organization", id: ORGANIZATION_ID },
          source: "join-request",
          actor,
        },
      });

      const byPolicy = attachedBy({
        type: "system",
        id: SYSTEM_ACTORS.joinRequests,
      });
      const byAdmin = attachedBy({ type: "user", id: "user_ana" });

      // `join-request` is deliberately NOT among the sources the trail skips.
      expect(isAuditableGrantEvent(byPolicy as never)).toBe(true);

      const policyRow = toAuthzAuditRow(byPolicy as never);
      const adminRow = toAuthzAuditRow(byAdmin as never);

      expect(policyRow.organizationId).toBe(ORGANIZATION_ID);
      expect(policyRow.metadata).toMatchObject({
        source: "join-request",
        principal: { type: "user", id: "user_sam" },
        roleKey: "MEMBER",
      });
      // No harder to find than a membership an admin approved by hand: the
      // same action, on the same page, differing only in who is named as the
      // actor — nobody, because nobody clicked.
      expect(policyRow.action).toBe(adminRow.action);
      expect(policyRow.userId).toBeNull();
      expect(adminRow.userId).toBe("user_ana");
    });
  });
});
