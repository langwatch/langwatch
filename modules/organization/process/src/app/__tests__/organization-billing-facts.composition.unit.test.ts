/**
 * Organization applies billing's writes to its rows from billing's facts (R42, round 46 D-b), as
 * `OrganizationModule.create` composes the lifecycle pipeline over the memory registry.
 * @see enterprise/modules/billing/specs/billing.feature
 */
import type { AuthzApi } from "@langwatch/authz-contract";
import {
  type BillingApi,
  CHECKOUT_CURRENCY_SELECTED_EVENT_TYPE,
  PLAN_LIMIT_ALERT_SENT_EVENT_TYPE,
  PRICING_MODEL_CHANGED_EVENT_TYPE,
  SEAT_CHECKOUT_PAID_EVENT_TYPE,
  SEAT_CHECKOUTS_ABANDONED_EVENT_TYPE,
} from "@langwatch/enterprise-billing-contract";
import type { EntitlementApi, Plan } from "@langwatch/entitlement-contract";
import { createTenantId, type Event, type EventSubscriberDefinition } from "@langwatch/eventing";
import type { IdentityApi } from "@langwatch/identity-contract";
import type { NotificationService } from "@langwatch/notification-contract";
import type { OrganizationCaller } from "@langwatch/organization-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { OrganizationModule } from "../organization.app.ts";
import { organizationModuleSetup } from "./support/organization-module-setup.ts";

const ORGANIZATION_ID = "org-1";
const CALLER: OrganizationCaller = { id: "user-1", name: "Sam", email: "sam@acme.test" };
const SENT_AT = Date.UTC(2026, 9, 8, 12);

const roomyPlan: Plan = {
  planSource: "free",
  type: "free",
  name: "Free",
  free: true,
  maxMembers: 1_000_000,
  maxMembersLite: 1_000_000,
  maxMessagesPerMonth: 1_000_000,
  canPublish: true,
  prices: { USD: 0, EUR: 0 },
};

type SeatCheckoutAsk = Parameters<BillingApi["createSeatCheckout"]>[0];

/**
 * The application over memory repositories holding one TIERED, USD organization and its admin.
 * `beyond` is what the inviter lacks; billing's checkout asks land in `checkouts`.
 */
async function application({ beyond = [] }: { beyond?: string[] } = {}) {
  const checkouts: SeatCheckoutAsk[] = [];
  const setup = organizationModuleSetup({
    permissions: createApiFixture<AuthzApi>(
      { findPermissionsBeyondCaller: async () => beyond },
      "AuthzApi",
    ),
    billing: createApiFixture<BillingApi>(
      {
        createSeatCheckout: async (ask: SeatCheckoutAsk) => {
          checkouts.push(ask);
          return { url: "https://checkout.test/cs_1", subscriptionId: "sub-checkout" };
        },
      },
      "BillingApi",
    ),
    entitlement: createApiFixture<EntitlementApi>(
      { getActivePlan: async () => roomyPlan, requestBound: async () => 1_000 },
      "EntitlementApi",
    ),
    identity: createApiFixture<IdentityApi>(
      { verifiedEmailsOf: async () => ({ kind: "keep_legacy" }) },
      "IdentityApi",
    ),
    notifications: createApiFixture<NotificationService>({}, "NotificationService"),
  });
  await setup.repositories.membership(setup.dependencies.permissions).createAndAssign({
    userId: CALLER.id,
    orgId: ORGANIZATION_ID,
    orgName: "ACME",
    orgSlug: "acme",
    teamId: "team-1",
    teamSlug: "engineering",
    pricingModel: "TIERED",
  });
  const app = await OrganizationModule.create(setup);
  return { app, checkouts, deliver: deliveryTo(app) };
}

/** The lifecycle pipeline's peer subscribers, as the runtime's global registry receives them. */
function deliveryTo(app: OrganizationModule) {
  const definition = app.lifecyclePipeline();
  const subscribers: EventSubscriberDefinition<Event>[] = [];
  const registry = createApiFixture<
    Parameters<NonNullable<typeof definition.globalProjections>[number]["register"]>[0]
  >({ registerEventSubscriber: (subscriber) => void subscribers.push(subscriber) });
  for (const projection of definition.globalProjections ?? []) projection.register(registry);

  return async (type: string, data: Record<string, unknown>) => {
    const subscriber = subscribers.find((candidate) => candidate.eventTypes.includes(type));
    if (!subscriber) throw new Error(`organization does not subscribe to ${type}`);
    const organizationId = String(data.organizationId);
    const fact = { tenantId: organizationId, occurredAt: SENT_AT, ...data };
    await subscriber.handle(
      {
        id: `evt_${type}`,
        aggregateId: organizationId,
        aggregateType: "billing_lifecycle",
        tenantId: createTenantId(organizationId),
        createdAt: SENT_AT,
        occurredAt: SENT_AT,
        type,
        version: "2026-09-30",
        data: fact,
      } as Event,
      { tenantId: organizationId, aggregateId: organizationId },
    );
  };
}

const invite = (email: string) => ({ email, role: "MEMBER" as const, teamIds: "team-1" });

async function holdInvites(app: OrganizationModule, subscriptionId: string, emails: string[]) {
  await app.createPaymentPendingInvites(
    { organizationId: ORGANIZATION_ID, subscriptionId, invites: emails.map(invite) },
    CALLER,
  );
}

async function invitations(app: OrganizationModule) {
  const listed = await app.listPendingInvitations({ organizationId: ORGANIZATION_ID });
  return listed
    .map(({ email, status }) => ({ email, status }))
    .toSorted((a, b) => a.email.localeCompare(b.email));
}

/** Every organisation-row fact billing records, once each. */
async function deliverEveryFact(deliver: ReturnType<typeof deliveryTo>) {
  await deliver(PLAN_LIMIT_ALERT_SENT_EVENT_TYPE, {
    organizationId: ORGANIZATION_ID,
    sentAt: SENT_AT,
  });
  await deliver(CHECKOUT_CURRENCY_SELECTED_EVENT_TYPE, {
    organizationId: ORGANIZATION_ID,
    currency: "EUR",
  });
  await deliver(PRICING_MODEL_CHANGED_EVENT_TYPE, {
    organizationId: ORGANIZATION_ID,
    pricingModel: "SEAT_EVENT",
  });
  await deliver(SEAT_CHECKOUT_PAID_EVENT_TYPE, {
    organizationId: ORGANIZATION_ID,
    subscriptionId: "sub-paid",
  });
  await deliver(SEAT_CHECKOUTS_ABANDONED_EVENT_TYPE, {
    organizationId: ORGANIZATION_ID,
    subscriptionIds: ["sub-abandoned"],
  });
}

describe("organization applying billing's organisation-row facts", () => {
  describe("when billing records that it sent the plan-limit alert", () => {
    /** @scenario "Organization stamps the plan-limit alert from billing's fact" */
    it("stamps the organization with the instant billing recorded", async () => {
      const { app, deliver } = await application();

      await deliver(PLAN_LIMIT_ALERT_SENT_EVENT_TYPE, {
        organizationId: ORGANIZATION_ID,
        sentAt: SENT_AT,
      });

      const organization = await app.getWithAdministrators({ organizationId: ORGANIZATION_ID });
      expect(organization.sentPlanLimitAlert).toEqual(
        Temporal.Instant.fromEpochMilliseconds(SENT_AT),
      );
    });
  });

  describe("when billing records a checkout currency and a pricing model", () => {
    /** @scenario "Organization sets the checkout currency and the pricing model from billing's facts" */
    it("sets both columns on the organization", async () => {
      const { app, deliver } = await application();

      await deliver(CHECKOUT_CURRENCY_SELECTED_EVENT_TYPE, {
        organizationId: ORGANIZATION_ID,
        currency: "EUR",
      });
      await deliver(PRICING_MODEL_CHANGED_EVENT_TYPE, {
        organizationId: ORGANIZATION_ID,
        pricingModel: "SEAT_EVENT",
      });

      await expect(app.getPricing({ organizationId: ORGANIZATION_ID })).resolves.toEqual({
        pricingModel: "SEAT_EVENT",
        currency: "EUR",
      });
    });
  });

  describe("when billing records that a seat checkout was paid", () => {
    /** @scenario "Organization opens a paid seat checkout's held invitations from billing's fact" */
    it("opens that checkout's invitations and leaves another checkout's held", async () => {
      const { app, deliver } = await application();
      await holdInvites(app, "sub-paid", ["ann@acme.test"]);
      await holdInvites(app, "sub-other", ["bob@acme.test"]);

      await deliver(SEAT_CHECKOUT_PAID_EVENT_TYPE, {
        organizationId: ORGANIZATION_ID,
        subscriptionId: "sub-paid",
      });

      await expect(invitations(app)).resolves.toEqual([
        { email: "ann@acme.test", status: "PENDING" },
      ]);

      // The other checkout's invitation was held, not dropped: its own payment opens it.
      await deliver(SEAT_CHECKOUT_PAID_EVENT_TYPE, {
        organizationId: ORGANIZATION_ID,
        subscriptionId: "sub-other",
      });
      await expect(invitations(app)).resolves.toEqual([
        { email: "ann@acme.test", status: "PENDING" },
        { email: "bob@acme.test", status: "PENDING" },
      ]);
    });
  });

  describe("when billing records that seat checkouts were abandoned", () => {
    /** @scenario "Organization cancels the held invitations of abandoned seat checkouts from billing's fact" */
    it("drops the invitations both checkouts held", async () => {
      const { app, deliver } = await application();
      await holdInvites(app, "sub-a", ["ann@acme.test"]);
      await holdInvites(app, "sub-b", ["bob@acme.test"]);

      await deliver(SEAT_CHECKOUTS_ABANDONED_EVENT_TYPE, {
        organizationId: ORGANIZATION_ID,
        subscriptionIds: ["sub-a", "sub-b"],
      });
      // A late payment of either checkout then finds nothing held to open.
      for (const subscriptionId of ["sub-a", "sub-b"]) {
        await deliver(SEAT_CHECKOUT_PAID_EVENT_TYPE, {
          organizationId: ORGANIZATION_ID,
          subscriptionId,
        });
      }

      await expect(invitations(app)).resolves.toEqual([]);
    });
  });

  describe("when every fact is delivered a second time", () => {
    /** @scenario "A redelivered billing fact leaves the organisation as one delivery did" */
    it("leaves the columns and the invitations as one delivery left them", async () => {
      const { app, deliver } = await application();
      await holdInvites(app, "sub-paid", ["ann@acme.test"]);
      await holdInvites(app, "sub-abandoned", ["bob@acme.test"]);

      await deliverEveryFact(deliver);
      const once = {
        pricing: await app.getPricing({ organizationId: ORGANIZATION_ID }),
        stamp: (await app.getWithAdministrators({ organizationId: ORGANIZATION_ID }))
          .sentPlanLimitAlert,
        invitations: await invitations(app),
      };
      await deliverEveryFact(deliver);

      expect({
        pricing: await app.getPricing({ organizationId: ORGANIZATION_ID }),
        stamp: (await app.getWithAdministrators({ organizationId: ORGANIZATION_ID }))
          .sentPlanLimitAlert,
        invitations: await invitations(app),
      }).toEqual(once);
    });
  });

  describe("when the organisation is gone before its fact arrives", () => {
    it("applies nothing and does not ask for a retry", async () => {
      const { deliver } = await application();

      await expect(
        deliver(CHECKOUT_CURRENCY_SELECTED_EVENT_TYPE, {
          organizationId: "org-gone",
          currency: "EUR",
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("when an administrator upgrades with invitations through the invite door", () => {
    const upgrade = {
      organizationId: ORGANIZATION_ID,
      baseUrl: "https://app.langwatch.test",
      currency: "EUR" as const,
      totalSeats: 3,
      invites: [{ email: "ann@acme.test", role: "MEMBER" as const }],
    };

    /** @scenario "Organization's invite door refuses invitations above the inviter before any checkout opens" */
    /** @scenario A seat checkout inviting past the inviter writes nothing */
    it("refuses past the inviter before billing opens a checkout", async () => {
      const { app, checkouts, deliver } = await application({ beyond: ["organization:manage"] });

      await expect(app.createSeatCheckoutWithInvites(upgrade, CALLER)).rejects.toMatchObject({
        code: "grant_exceeds_caller_permissions",
      });
      expect(checkouts).toEqual([]);
      await deliver(SEAT_CHECKOUT_PAID_EVENT_TYPE, {
        organizationId: ORGANIZATION_ID,
        subscriptionId: "sub-checkout",
      });
      await expect(invitations(app)).resolves.toEqual([]);
    });

    /** @scenario "Organization holds the invitations against the pending subscription billing opened" */
    /** @scenario Inviting through a seat checkout is bounded by the inviter */
    it("opens billing's checkout, then holds the invitations on the subscription it opened", async () => {
      const { app, checkouts, deliver } = await application();

      await expect(app.createSeatCheckoutWithInvites(upgrade, CALLER)).resolves.toEqual({
        url: "https://checkout.test/cs_1",
      });
      expect(checkouts).toEqual([
        {
          organizationId: ORGANIZATION_ID,
          baseUrl: "https://app.langwatch.test",
          membersToAdd: 3,
          currency: "EUR",
          customerEmail: "sam@acme.test",
        },
      ]);
      await expect(invitations(app)).resolves.toEqual([]);

      await deliver(SEAT_CHECKOUT_PAID_EVENT_TYPE, {
        organizationId: ORGANIZATION_ID,
        subscriptionId: "sub-checkout",
      });
      await expect(invitations(app)).resolves.toEqual([
        { email: "ann@acme.test", status: "PENDING" },
      ]);
    });
  });
});
