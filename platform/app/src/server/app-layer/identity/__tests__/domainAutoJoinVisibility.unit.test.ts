/** @vitest-environment node */

import { SYSTEM_ACTORS } from "@langwatch/actor";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
import type { Prisma } from "~/generated/prisma/client";
import type { GrantsLedgerWriter } from "~/server/app-layer/authz/ledger";
import { attachMembershipGrantIntentSchema } from "~/server/event-sourcing/pipelines/join-requests/process-manager/joinRequestLifecycle.process";

// The argument is declared so `mock.calls` carries it: `async () => undefined`
// types the arguments as an EMPTY tuple, and the forwarders below pass one.
vi.mock("~/server/mailer/joinRequestEmails", () => ({
  renderDomainAutoJoinedEmail: vi.fn(
    async ({ adminEmail }: { adminEmail: string }) => ({
      to: adminEmail,
      subject: "joined",
      html: "html",
    }),
  ),
  renderJoinRequestApprovedEmail: vi.fn(),
  renderJoinRequestArrivedEmail: vi.fn(),
  renderJoinRequestExpiredEmail: vi.fn(),
  renderJoinRequestRejectedEmail: vi.fn(),
  renderJoinRequestReminderEmail: vi.fn(),
}));
vi.mock("~/server/mailer/emailSender", () => ({
  computeDefaultFrom: () => "LangWatch <test@example.com>",
  sendEmail: vi.fn(),
}));

import { GRANT_ATTACHED_EVENT_TYPE } from "~/server/event-sourcing/pipelines/authz-grants/schemas/constants";
import {
  isAuditableGrantEvent,
  toAuthzAuditRow,
} from "~/server/event-sourcing/pipelines/authz-grants/subscribers/authzAuditTrail.subscriber";
import { InMemoryProcessStore } from "~/server/event-sourcing/process-manager/stores/inMemoryProcessStore";
import {
  EmailJoinRequestNotifier,
  PrismaJoinMembership,
} from "../join-request-adapters";

const ORGANIZATION_ID = "org_acme";

/** Just the reads these two adapters make, and nothing else. */
function fakePrisma({
  membershipInserted = 1,
}: {
  membershipInserted?: number;
} = {}) {
  const processManagerOutbox = {
    createMany: vi.fn(
      async (_args: Prisma.ProcessManagerOutboxCreateManyArgs) => ({
        count: 1,
      }),
    ),
  };
  const organizationUser = {
    findMany: vi.fn(async () => [
      { userId: "user_ana" },
      { userId: "user_ivan" },
    ]),
    createMany: vi.fn(async () => ({ count: membershipInserted })),
    findUnique: vi.fn(async () => null),
    findUniqueOrThrow: vi.fn(async () => ({ membershipStamp: "stamp_1" })),
  };
  return {
    $transaction: vi.fn(async (callback: (tx: unknown) => unknown) =>
      callback({ organizationUser, processManagerOutbox }),
    ),
    organization: {
      findUnique: vi.fn(async () => ({ name: "Acme" })),
    },
    organizationUser,
    processManagerOutbox,
    user: {
      findMany: vi.fn(async () => [
        { email: "ana@acme.com" },
        { email: "ivan@acme.com" },
      ]),
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
      const processStore = new InMemoryProcessStore();
      const notifier = new EmailJoinRequestNotifier(
        prisma as never,
        processStore,
      );

      await notifier.joinedAutomatically({
        organizationId: ORGANIZATION_ID,
        requesterUserId: "user_sam",
        domain: "acme.com",
      });

      const messages = await processStore.findMessagesByRef({
        ref: {
          processName: "joinRequestLifecycle",
          projectId: ORGANIZATION_ID,
          processKey: `automatic:${ORGANIZATION_ID}:user_sam:acme.com`,
        },
      });
      const fanout = messages.find(
        (message) => message.intentType === "fanoutNotification",
      );
      expect(fanout).toBeDefined();
      expect(fanout?.payload).toMatchObject({
        kind: "joinedAutomatically",
        organizationId: ORGANIZATION_ID,
        messages: [
          expect.objectContaining({ recipientUserId: "user_ana" }),
          expect.objectContaining({ recipientUserId: "user_ivan" }),
        ],
      });
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
        joinRequestId: "jreq_1",
        commandId: "join-approve:jreq_1:policy:domain-auto",
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

    it("persists a replayable grant intent before the first grant attempt", async () => {
      const prisma = fakePrisma();
      const attachBindings = vi
        .fn<GrantsLedgerWriter["attachBindings"]>()
        .mockRejectedValueOnce(new Error("projection unavailable"))
        .mockResolvedValueOnce({ attached: ["binding_1"], duplicates: [] });
      const membership = new PrismaJoinMembership(
        prisma as never,
        { attachBindings } as never,
      );

      await expect(
        membership.attachDefaultMembership({
          userId: "user_sam",
          organizationId: ORGANIZATION_ID,
          joinRequestId: "jreq_retry",
          commandId: "join-approve:jreq_retry:admin:ana",
          approvedByUserId: "user_ana",
        }),
      ).rejects.toThrow("projection unavailable");

      const intentData =
        prisma.processManagerOutbox.createMany.mock.calls[0]?.[0].data;
      const firstIntent = Array.isArray(intentData)
        ? intentData[0]
        : intentData;
      expect(firstIntent).toMatchObject({
        messageKey: "join-membership-grant:join-approve:jreq_retry:admin:ana",
        intentType: "attachMembershipGrant",
      });
      if (!firstIntent) throw new Error("grant intent was not persisted");

      const payload = attachMembershipGrantIntentSchema.parse(
        firstIntent.payload,
      );
      await membership.attachMembershipGrant(payload);

      expect(attachBindings).toHaveBeenCalledTimes(2);
      expect(attachBindings.mock.calls[0]?.[0]).toMatchObject({
        commandId: "join-approve:jreq_retry:admin:ana",
        occurredAtMs: expect.any(Number),
        requireProjection: true,
        bindings: [
          expect.objectContaining({
            bindingId: payload.bindingId,
            membershipStamp: "stamp_1",
          }),
        ],
      });
      expect(attachBindings.mock.calls[1]?.[0]).toEqual(
        attachBindings.mock.calls[0]?.[0],
      );
    });

    it("does not create an intent or grant for an existing member", async () => {
      const prisma = fakePrisma({ membershipInserted: 0 });
      const attachBindings = vi.fn();
      const membership = new PrismaJoinMembership(
        prisma as never,
        { attachBindings } as never,
      );

      await membership.attachDefaultMembership({
        userId: "user_sam",
        organizationId: ORGANIZATION_ID,
        joinRequestId: "jreq_existing",
        commandId: "join-approve:jreq_existing:admin:ana",
        approvedByUserId: "user_ana",
      });

      expect(prisma.processManagerOutbox.createMany).not.toHaveBeenCalled();
      expect(attachBindings).not.toHaveBeenCalled();
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
