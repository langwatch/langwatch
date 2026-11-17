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
import { MemoryNurturingMilestonesRepository } from "../../repositories/memory/memory.nurturing-milestones.repository.ts";
import { MemoryNurturingProjectDirectoryRepository } from "../../repositories/memory/memory.nurturing-project-directory.repository.ts";
import { MemoryNurturingClaimRepository } from "../../repositories/memory/memory.nurturing.repositories.ts";
import { subscriptionChangedSignal } from "../../rules/nurturing-owner-signals.rules.ts";
import { NurturingDeliveryService } from "../nurturing-delivery.service.ts";
import { NurturingMemberFactsService } from "../nurturing-member-facts.service.ts";
import { NoCustomerIoChannelError } from "../nurturing-plan-sync.service.ts";
import { NurturingService } from "../nurturing.service.ts";

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
    channel: HttpCustomerIoChannel.create({
      config: { customerIoApiKey: "key", customerIoRegion: "us" },
      fetchFn,
      errorReporter: { capture: () => {} },
    }),
  });
  return { service, sent, paths, refusing };
}

/** A delivery whose own copy names admin-1 as org-1's admin; `claims` may be shared. */
async function deliveryOver({
  customerIo,
  claims = MemoryNurturingClaimRepository.create(),
}: {
  customerIo: NurturingService | undefined;
  claims?: MemoryNurturingClaimRepository;
}) {
  const milestones = MemoryNurturingMilestonesRepository.create();
  await milestones.recordOrganization({
    organizationId: "org-1",
    adminUserId: "admin-1",
    seeded: false,
  });
  return NurturingDeliveryService.create({
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
async function liveRequestsOf(fact: SubscriptionChangedEventData) {
  const cio = recordingCustomerIo();
  await deliverFact(await deliveryOver({ customerIo: cio.service }), fact);
  await settle();
  return cio;
}

/** Every request a fact sends for a plan: the admin's group call, then both members. */
const requestsFor = ({ plan, hasSubscription }: { plan: string; hasSubscription: boolean }) => {
  const traits = { has_subscription: hasSubscription, plan };
  return [
    [{ type: "group", userId: "admin-1", groupId: "org-1", traits: { plan } }],
    [
      { type: "identify", userId: "user-1", traits },
      { type: "identify", userId: "user-2", traits },
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
    it("sends the plan free", async () => {
      const { sent } = await liveRequestsOf(subscriptionChangedFacts.pendingOnly);

      expect(sent).toEqual(requestsFor({ plan: "free", hasSubscription: true }));
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
          { type: "identify", userId: "user-1", traits: { has_subscription: true } },
          { type: "identify", userId: "user-2", traits: { has_subscription: true } },
        ],
      ]);
    });
  });

  describe("when the resync's catch-up fact is delivered twice", () => {
    /**
     * @scenario "A resync run records each organization's plan, name and members once and a second run sends the same values"
     */
    it("sends the plan and name to the company and the plan to each member, the same both times", async () => {
      const cio = recordingCustomerIo();
      const delivery = await deliveryOver({ customerIo: cio.service });
      const traits = { has_subscription: true, plan: "launch" };
      const group = {
        type: "group",
        userId: "admin-1",
        groupId: "org-1",
        traits: { plan: "launch", name: "Acme" },
      };
      const once = [
        [group],
        [
          { type: "identify", userId: "user-1", traits },
          { type: "identify", userId: "user-2", traits },
        ],
      ];

      await deliverFact(delivery, subscriptionChangedFacts.caughtUp);
      await deliverFact(delivery, subscriptionChangedFacts.caughtUp);

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

      await expect(deliverFact(delivery, subscriptionChangedFacts.caughtUp)).rejects.toThrow();
      await expect(deliverFact(delivery, other)).resolves.toBeUndefined();
      const deliveredOther = [...cio.sent];
      cio.refusing.clear();
      await deliverFact(delivery, subscriptionChangedFacts.caughtUp);

      expect(deliveredOther.flat().map((call) => call.userId)).toEqual(["user-3", "user-3"]);
      expect(cio.sent.slice(deliveredOther.length).flat().map((call) => call.userId)).toEqual([
        "admin-1",
        "user-1",
        "user-2",
      ]);
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
