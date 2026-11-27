// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * Delivers billing's own fixture facts, the ones billing's tests assert it records, so a change
 * to the fact breaks both. @see enterprise/modules/nurturing/specs/customer-io-plan-traits.feature
 */
import {
  type SubscriptionChangedEventData,
  subscriptionChangedEventDataSchema,
} from "@langwatch/enterprise-billing-contract";
import {
  subscriptionChangedFactFixture,
  subscriptionChangedFacts,
} from "@langwatch/enterprise-billing-contract/testing";
import type { CioBatchCall } from "@langwatch/enterprise-nurturing-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { UserApi } from "@langwatch/user-contract";
import { describe, expect, it, vi } from "vitest";

import { HttpCustomerIoChannel } from "../../channels/http/http.customer-io.channel.ts";
import { MemoryNurturingErasedUserRepository } from "../../repositories/memory/memory.nurturing-erased-user.repository.ts";
import { MemoryNurturingMilestonesRepository } from "../../repositories/memory/memory.nurturing-milestones.repository.ts";
import type { MemoryNurturingOrganizationMemberRepository } from "../../repositories/memory/memory.nurturing-organization-member.repository.ts";
import { MemoryNurturingProjectDirectoryRepository } from "../../repositories/memory/memory.nurturing-project-directory.repository.ts";
import { MemoryNurturingClaimRepository } from "../../repositories/memory/memory.nurturing.repositories.ts";
import { subscriptionChangedSignal } from "../../rules/nurturing-owner-signals.rules.ts";
import { NurturingDeliveryService } from "../nurturing-delivery.service.ts";
import { NurturingMemberFactsService } from "../nurturing-member-facts.service.ts";
import { NoCustomerIoChannelError } from "../nurturing-plan-sync.service.ts";
import { NurturingService } from "../nurturing.service.ts";
import { memberCopyOf } from "./nurturing-member-facts.test-helpers.ts";
import { peopleWithEmails } from "./nurturing-person-email.test-helpers.ts";

/** Customer.io over a recording fetch: each accepted request's batch, and the refused ones. */
function recordingCustomerIo() {
  const sent: CioBatchCall[][] = [];
  const paths: string[] = [];
  const refusing = new Set<string>();
  const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const body: unknown = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    const batch = (body as { batch: CioBatchCall[] }).batch;
    if (batch.some((call) => refusing.has(call.userId))) return new Response(null, { status: 500 });
    paths.push(new URL(url instanceof Request ? url.url : url).pathname);
    sent.push(batch);
    return new Response(null, { status: 200 });
  });
  const service = NurturingService.create({
    users: peopleWithEmails(),
    channel: HttpCustomerIoChannel.create({
      config: { customerIoApiKey: "key", customerIoRegion: "us" },
      fetchFn,
      errorReporter: { capture: () => {} },
    }),
  });
  return { service, sent, paths, refusing };
}

/**
 * The member copy the linked fixtures need: user-1 and user-2 current members of org-1 alone,
 * user-3 of org-2.
 */
async function fixtureMemberCopy(): Promise<MemoryNurturingOrganizationMemberRepository> {
  const members = await memberCopyOf({ organizationId: "org-1", userIds: ["user-1", "user-2"] });
  await members.recordMembershipChange({
    organizationId: "org-2",
    userId: "user-3",
    change: "joined",
    at: 1,
  });
  return members;
}

/**
 * A delivery whose own copy names admin-1 as org-1's admin, over the fixtures' member copy unless
 * `members` is given; `claims` may be shared.
 */
async function deliveryOver({
  customerIo,
  claims = MemoryNurturingClaimRepository.create(),
  members,
  erasedUsers = MemoryNurturingErasedUserRepository.create(),
}: {
  customerIo: NurturingService | undefined;
  claims?: MemoryNurturingClaimRepository;
  members?: MemoryNurturingOrganizationMemberRepository;
  erasedUsers?: MemoryNurturingErasedUserRepository;
}) {
  const milestones = MemoryNurturingMilestonesRepository.create();
  await milestones.recordOrganization({
    organizationId: "org-1",
    adminUserId: "admin-1",
    seeded: false,
  });
  return NurturingDeliveryService.create({
    erasedUsers,
    claims,
    customerIo,
    posthog: undefined,
    users: createApiFixture<UserApi>({}),
    memberFacts: NurturingMemberFactsService.create({
      claims,
      milestones,
      projects: MemoryNurturingProjectDirectoryRepository.create(),
      organizations: createApiFixture<OrganizationApi>({}),
    }),
    members: members ?? (await fixtureMemberCopy()),
  });
}

/** Billing's fact through nurturing's subscriber rule into delivery, as the pipeline does. */
function deliverFact(delivery: NurturingDeliveryService, fact: SubscriptionChangedEventData) {
  const signal = subscriptionChangedSignal({ data: fact, aggregateId: fact.organizationId });
  return delivery.deliver({ key: `${signal.kind}:${signal.sourceEventId}`, signal });
}

/** Lets the fire-and-forget sends settle before the assertions read them. */
async function settle(): Promise<void> {
  for (let tick = 0; tick < 3; tick++) await new Promise((resolve) => setTimeout(resolve, 0));
}

/** The requests a delivered live fact sends: the company call, then the members. */
async function liveRequestsOf(
  fact: SubscriptionChangedEventData,
  members?: MemoryNurturingOrganizationMemberRepository,
  erasedUsers?: MemoryNurturingErasedUserRepository,
) {
  const cio = recordingCustomerIo();
  await deliverFact(await deliveryOver({ customerIo: cio.service, members, erasedUsers }), fact);
  await settle();
  return cio;
}

/** Every request a fact sends for a plan: the admin's group call, then both members, with their emails. */
const requestsFor = ({ plan, hasSubscription }: { plan: string; hasSubscription: boolean }) => {
  const traits = { has_subscription: hasSubscription, plan };
  return [
    [{ type: "group", userId: "admin-1", groupId: "org-1", traits: { plan } }],
    [
      { type: "identify", userId: "user-1", traits: { ...traits, email: "user-1@example.com" } },
      { type: "identify", userId: "user-2", traits: { ...traits, email: "user-2@example.com" } },
    ],
  ];
};

const plansOf = (requests: CioBatchCall[][]) =>
  requests.flat().map((call) => ("traits" in call ? call.traits?.plan : undefined));

describe("NurturingDeliveryService, delivering billing's subscription_changed fact", () => {
  describe("when a subscription became active on a paid plan", () => {
    /** @scenario "A started subscription tells Customer.io the plan on members and company" */
    it("identifies each member with the plan in lower case and groups the admin", async () => {
      const { sent, paths } = await liveRequestsOf(subscriptionChangedFactFixture());

      expect(sent).toEqual(requestsFor({ plan: "launch", hasSubscription: true }));
      expect(paths).toEqual(["/v1/batch", "/v1/batch"]);
    });

    it("sends nothing for an organization with no active member", async () => {
      const { sent } = await liveRequestsOf(subscriptionChangedFactFixture({ memberUserIds: [] }));

      expect(sent).toEqual([]);
    });
  });

  describe("when a member is current in another organization", () => {
    /** @scenario "A member current in another organization is not told this plan" */
    it("groups the admin and does not identify that member", async () => {
      const members = await fixtureMemberCopy();
      await members.recordMembershipChange({
        organizationId: "org-3",
        userId: "user-2",
        change: "joined",
        at: 2,
      });

      const { sent } = await liveRequestsOf(subscriptionChangedFactFixture(), members);

      const traits = { has_subscription: true, plan: "launch", email: "user-1@example.com" };
      expect(sent).toEqual([
        [{ type: "group", userId: "admin-1", groupId: "org-1", traits: { plan: "launch" } }],
        [{ type: "identify", userId: "user-1", traits }],
      ]);
    });
  });

  describe("when billing's fact names a member who was erased", () => {
    /** @scenario "A subscription fact naming an erased member tells them nothing" */
    it("groups the admin and identifies only the other member, whose row still stands", async () => {
      const erasedUsers = MemoryNurturingErasedUserRepository.create();
      await erasedUsers.markErased({ userId: "user-2" });

      const { sent } = await liveRequestsOf(
        subscriptionChangedFactFixture(),
        await fixtureMemberCopy(),
        erasedUsers,
      );

      const traits = { has_subscription: true, plan: "launch", email: "user-1@example.com" };
      expect(sent).toEqual([
        [{ type: "group", userId: "admin-1", groupId: "org-1", traits: { plan: "launch" } }],
        [{ type: "identify", userId: "user-1", traits }],
      ]);
    });
  });

  describe("when a member's only row in the copy is a current one in another organization", () => {
    /** @scenario "A member current in another organization is not told this plan" */
    it("does not identify that member, though the copy holds no row of theirs here", async () => {
      const members = await memberCopyOf({ organizationId: "org-1", userIds: ["user-1"] });
      await members.recordMembershipChange({
        organizationId: "org-2",
        userId: "user-2",
        change: "joined",
        at: 1,
      });

      const { sent } = await liveRequestsOf(subscriptionChangedFactFixture(), members);

      expect(sent.flat().map(({ type, userId }) => [type, userId])).toEqual([
        ["group", "admin-1"],
        ["identify", "user-1"],
      ]);
    });
  });

  describe("when nurturing holds no membership copy for a member", () => {
    it("still identifies that member, as billing lists them active", async () => {
      const members = await memberCopyOf({ organizationId: "org-1", userIds: ["user-1"] });

      const { sent } = await liveRequestsOf(subscriptionChangedFactFixture(), members);

      expect(sent).toEqual(requestsFor({ plan: "launch", hasSubscription: true }));
    });

    it("skips that member for a catch-up fact, which still groups the admin", async () => {
      const cio = recordingCustomerIo();
      const members = await memberCopyOf({ organizationId: "org-1", userIds: ["user-1"] });
      const delivery = await deliveryOver({ customerIo: cio.service, members });

      await deliverFact(delivery, subscriptionChangedFacts.caughtUp);

      expect(cio.sent.flat().map(({ type, userId }) => [type, userId])).toEqual([
        ["group", "admin-1"],
        ["identify", "user-1"],
      ]);
    });
  });

  describe("when the copy shows a member left here and current nowhere else", () => {
    it("still identifies them: billing lists them active and the copy names no other plan of theirs", async () => {
      const members = await fixtureMemberCopy();
      await members.recordMembershipChange({
        organizationId: "org-1",
        userId: "user-2",
        change: "left",
        at: 2,
      });

      const { sent } = await liveRequestsOf(subscriptionChangedFactFixture(), members);

      expect(sent).toEqual(requestsFor({ plan: "launch", hasSubscription: true }));
    });
  });

  describe("when the seat-event subscription replaces the tiered one", () => {
    /** @scenario "A paid-to-paid change shows the new plan and never free" */
    it("tells Customer.io the seat-event plan, and no call carries free", async () => {
      const { sent } = await liveRequestsOf(subscriptionChangedFacts.seatEventActivated);

      expect(sent).toEqual(requestsFor({ plan: "growth_seat_eur_monthly", hasSubscription: true }));
      expect(plansOf(sent)).not.toContain("free");
    });
  });

  describe("when the organization's only active subscription is cancelled", () => {
    /** @scenario "Cancelling the last active subscription returns the organization to free" */
    it("shows plan free and has_subscription false on members and company", async () => {
      const { sent } = await liveRequestsOf(subscriptionChangedFacts.lastCancelled);

      expect(sent).toEqual(requestsFor({ plan: "free", hasSubscription: false }));
    });
  });

  describe("when one of two active subscriptions is cancelled", () => {
    /** @scenario "Cancelling one of two subscriptions keeps the other's plan" */
    it("shows the remaining subscription's plan", async () => {
      const { sent } = await liveRequestsOf(subscriptionChangedFacts.otherRemains);

      expect(sent).toEqual(requestsFor({ plan: "launch", hasSubscription: true }));
    });
  });

  describe("when only a pending checkout remains", () => {
    /** @scenario "A pending checkout does not make the plan paid" */
    it("sends the plan free and has_subscription false", async () => {
      const { sent } = await liveRequestsOf(subscriptionChangedFacts.pendingOnly);

      expect(sent).toEqual(requestsFor({ plan: "free", hasSubscription: false }));
    });
  });

  describe("when a fact billing stored before it carried a plan is delivered", () => {
    /** @scenario "A subscription_changed fact stored before it carried a plan sends no plan" */
    it("identifies the members with has_subscription only, and sends no plan trait", async () => {
      const stored = subscriptionChangedEventDataSchema.parse(
        Object.fromEntries(
          Object.entries(subscriptionChangedFactFixture()).filter(([key]) => key !== "plan"),
        ),
      );

      const { sent } = await liveRequestsOf(stored);

      expect(sent).toEqual([
        [
          {
            type: "identify",
            userId: "user-1",
            traits: { has_subscription: true, email: "user-1@example.com" },
          },
          {
            type: "identify",
            userId: "user-2",
            traits: { has_subscription: true, email: "user-2@example.com" },
          },
        ],
      ]);
    });
  });

  describe("when two resync runs each deliver a catch-up fact", () => {
    /**
     * @scenario "A resync run records each organization's plan and members once and a second run sends the same values"
     */
    it("sends the plan to the company and to each member, the same both times", async () => {
      const cio = recordingCustomerIo();
      const delivery = await deliveryOver({ customerIo: cio.service });
      const { caughtUp } = subscriptionChangedFacts;

      await deliverFact(delivery, caughtUp);
      await deliverFact(delivery, { ...caughtUp, occurredAt: caughtUp.occurredAt + 1 });

      const once = requestsFor({ plan: "launch", hasSubscription: true });
      expect(cio.sent).toEqual([...once, ...once]);
    });
  });

  describe("when Customer.io refuses one organization's catch-up calls", () => {
    /** @scenario "A refused organization retries on its own" */
    it("fails that fact alone, delivers the other, and sends the refused one on its retry", async () => {
      const cio = recordingCustomerIo();
      const delivery = await deliveryOver({ customerIo: cio.service });
      const other = subscriptionChangedFactFixture({
        ...subscriptionChangedFacts.caughtUp,
        tenantId: "org-2",
        organizationId: "org-2",
        memberUserIds: ["user-3"],
      });
      cio.refusing.add("admin-1");

      await expect(deliverFact(delivery, subscriptionChangedFacts.caughtUp)).rejects.toThrow(
        "Customer.io /batch failed: HTTP 500",
      );
      await expect(deliverFact(delivery, other)).resolves.toBeUndefined();
      const deliveredOther = [...cio.sent];
      cio.refusing.clear();
      await deliverFact(delivery, subscriptionChangedFacts.caughtUp);

      expect(deliveredOther.flat().map((call) => call.userId)).toEqual(["user-3", "user-3"]);
      expect(
        cio.sent
          .slice(deliveredOther.length)
          .flat()
          .map((call) => call.userId),
      ).toEqual(["admin-1", "user-1", "user-2"]);
    });
  });

  describe("when Customer.io refuses a live change", () => {
    it("fails the delivery and gives its claim back, so its retry sends the change", async () => {
      const cio = recordingCustomerIo();
      const delivery = await deliveryOver({ customerIo: cio.service });
      const live = subscriptionChangedFactFixture({ plan: "GROWTH" });
      cio.refusing.add("admin-1");

      await expect(deliverFact(delivery, live)).rejects.toThrow(
        "Customer.io /batch failed: HTTP 500",
      );

      cio.refusing.clear();
      await deliverFact(delivery, live);
      expect(cio.sent).toEqual(requestsFor({ plan: "growth", hasSubscription: true }));
    });
  });

  describe("when the deployment names no Customer.io key", () => {
    /** @scenario "A catch-up fact with no Customer.io channel fails visibly" */
    it("fails with no_customer_io_channel and claims nothing, so a replay delivers it", async () => {
      const claims = MemoryNurturingClaimRepository.create();
      const keyless = await deliveryOver({ customerIo: undefined, claims });

      const failed = deliverFact(keyless, subscriptionChangedFacts.caughtUp);

      await expect(failed).rejects.toBeInstanceOf(NoCustomerIoChannelError);
      await expect(failed).rejects.toMatchObject({ code: "no_customer_io_channel" });
      const cio = recordingCustomerIo();
      const replay = await deliveryOver({ customerIo: cio.service, claims });
      await deliverFact(replay, subscriptionChangedFacts.caughtUp);
      expect(cio.sent).toHaveLength(2);
    });

    it("still drops a live fact quietly, as every lifecycle signal without a sink", async () => {
      const keyless = await deliveryOver({ customerIo: undefined });

      await expect(
        deliverFact(keyless, subscriptionChangedFacts.otherRemains),
      ).resolves.toBeUndefined();
    });
  });
});
