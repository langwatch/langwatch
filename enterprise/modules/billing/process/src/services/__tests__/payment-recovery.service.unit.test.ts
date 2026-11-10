/**
 * @vitest-environment node
 *
 * Failed payment recovery over memory twins: a failed renewal opens one case, emails go out on
 * days 3, 7, 14 and 21, a paid invoice closes it with one restored email once one went out.
 * @see ../../../../specs/payment-recovery.feature
 */
import type { AuthzApi } from "@langwatch/authz-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { Temporal, type Instant } from "@langwatch/time";
import { beforeEach, describe, expect, it } from "vitest";

import type { AccountPaymentFailedAlert } from "../../channels/billing-webhook-host.channel.ts";
import { MemoryPaymentRecoveryEmailChannel } from "../../channels/memory/memory.billing.channels.ts";
import { MemoryStripeInvoicesChannel } from "../../channels/memory/memory.stripe-invoices.channel.ts";
import { MemoryBillingOrganizationRepository } from "../../repositories/memory/memory.billing-account-facts.repository.ts";
import { MemoryBillingWebhookSubscriptionRepository } from "../../repositories/memory/memory.billing-webhook-subscription.repository.ts";
import { MemoryBillingStore } from "../../repositories/memory/memory.billing.store.ts";
import { MemoryPaymentRecoveryRepository } from "../../repositories/memory/memory.payment-recovery.repository.ts";
import { MemoryBillingSubscriptionRepository } from "../../repositories/memory/memory.subscription.repository.ts";
import { PaymentRecoveryService, type RecoveryInvoice } from "../payment-recovery.service.ts";

type BillingMember = Awaited<ReturnType<AuthzApi["listBillingMembers"]>>[number];

const DAY_0 = Temporal.Instant.from("2026-11-02T09:00:00Z");
const BASE = "https://app.langwatch.test";

const RENEWAL: RecoveryInvoice = {
  id: "in_renewal",
  subscriptionId: "sub_stripe_1",
  collectionMethod: "charge_automatically",
  billingReason: "subscription_cycle",
  amountDue: 28072,
  currency: "eur",
  number: "LW-0042",
  created: DAY_0.epochMilliseconds / 1000,
};

function dayOf(days: number, hours = 0): Instant {
  return DAY_0.add({ hours: days * 24 + hours });
}

function setUp({ plan = "GROWTH_SEAT_EUR_MONTHLY" }: { plan?: string } = {}) {
  const store = MemoryBillingStore.create();
  let now = DAY_0;
  store.organizations.set("org_1", {
    id: "org_1",
    name: "ACME",
    stripeCustomerId: "cus_1",
    pricingModel: "SEAT_EVENT",
    currency: "EUR",
    selfHostedCustomer: false,
    teamIds: [],
    signupData: {},
  });
  const people: [string, string, string][] = [
    ["user_admin_1", "ADMIN", "ana@acme.test"],
    ["user_admin_2", "ADMIN", "bo@acme.test"],
    ["user_billing", "MEMBER", "cy@acme.test"],
    ["user_plain", "MEMBER", "di@acme.test"],
  ];
  for (const [userId, role, email] of people) {
    store.members.push({ organizationId: "org_1", userId, role, disabled: false });
    store.users.set(userId, { id: userId, name: null, email, deactivated: false });
  }
  store.subscriptions.push({
    id: "sub_db_1",
    organizationId: "org_1",
    status: "ACTIVE",
    plan,
    stripeSubscriptionId: "sub_stripe_1",
    createdAt: DAY_0.subtract({ hours: 24 * 60 }),
    startDate: DAY_0.subtract({ hours: 24 * 60 }),
    endDate: null,
    maxMembers: 5,
    maxMembersLite: null,
    maxMessagesPerMonth: null,
    lastPaymentFailedDate: null,
    seatsKept: null,
    seatsKeptUntil: null,
  });
  const subscriptions = MemoryBillingSubscriptionRepository.create(store);
  const recoveries = MemoryPaymentRecoveryRepository.create(store);
  const invoices = MemoryStripeInvoicesChannel.create();
  invoices.seed({
    invoice: {
      id: RENEWAL.id,
      customerId: "cus_1",
      number: RENEWAL.number,
      created: RENEWAL.created,
      amountDue: RENEWAL.amountDue,
      currency: RENEWAL.currency,
      status: "open",
      pdfUrl: null,
      hostedUrl: "https://invoice.stripe.test/in_renewal",
    },
    card: { brand: "Visa", last4: "4242" },
  });
  const emails = MemoryPaymentRecoveryEmailChannel.create();
  const alerts: AccountPaymentFailedAlert[] = [];
  let billingMemberRefusals = 0;
  const service = PaymentRecoveryService.create({
    recoveries,
    subscriptions: MemoryBillingWebhookSubscriptionRepository.create({ subscriptions, store }),
    organizations: MemoryBillingOrganizationRepository.create(store),
    billingMembers: createApiFixture<AuthzApi>({
      listBillingMembers: async () => {
        if (billingMemberRefusals > 0) {
          billingMemberRefusals--;
          throw new Error("authorization is unreachable");
        }
        return [{ userId: "user_billing" } as BillingMember];
      },
    }),
    invoices,
    emails,
    alerts: {
      sendSlackAccountPaymentFailed: async (alert) => {
        alerts.push(alert);
      },
    },
    publicBaseUrl: BASE,
    now: () => now,
  });
  return {
    store,
    service,
    recoveries,
    invoices,
    emails,
    alerts,
    at: (instant: Instant) => {
      now = instant;
    },
    row: () => store.subscriptions[0]!,
    /** The next read of who holds the Billing role fails, as an authorization outage would. */
    refuseBillingMembersOnce: () => {
      billingMemberRefusals = 1;
    },
    kinds: () => emails.sent.map((sent) => sent.email.kind),
    /** Sets the invoice's status at Stripe, as a later read would answer it. */
    settle: (status: "paid" | "void") => invoices.settle({ invoiceId: RENEWAL.id, status }),
  };
}

describe("given an organization on an active paid subscription", () => {
  let world: ReturnType<typeof setUp>;
  beforeEach(() => {
    world = setUp();
  });

  describe("when Stripe reports a failed charge on its renewal invoice", () => {
    /** @scenario "The first failed charge opens a payment recovery case dated day 0" */
    it("opens a case for that invoice dated at the failed charge, moving to Free 21 days later", async () => {
      await world.service.paymentFailed({ invoice: RENEWAL });

      expect(world.row()).toMatchObject({
        status: "ACTIVE",
        paymentRecoveryInvoiceId: "in_renewal",
        paymentRecoveryStartedAt: DAY_0,
        paymentRecoveryNoticeDay: null,
      });
      const details = await world.service.details({ organizationId: "org_1" });
      expect(details).toMatchObject({
        state: "failing",
        startedAt: DAY_0.toString(),
        accessStopsAt: dayOf(21).toString(),
        invoiceNumber: "LW-0042",
        amountDue: 28072,
        currency: "eur",
        card: { brand: "Visa", last4: "4242" },
      });
    });

    /** @scenario "No email goes out on the day a payment fails" */
    it("mails nobody on day 0, nor on a sweep before day 3", async () => {
      await world.service.paymentFailed({ invoice: RENEWAL });
      world.at(dayOf(2, 23));
      await world.service.sweep();

      expect(world.emails.sent).toEqual([]);
      expect(world.row().paymentRecoveryNoticeDay).toBeNull();
    });
  });
});

describe("given an open recovery case for an invoice that failed 5 days ago", () => {
  /** @scenario "Stripe's later retries of the same invoice keep day 0 where it was" */
  it("keeps day 0 and sends no email on another failed charge", async () => {
    const world = setUp();
    await world.service.paymentFailed({ invoice: RENEWAL });
    world.at(dayOf(5));

    await world.service.paymentFailed({ invoice: RENEWAL });

    expect(world.row().paymentRecoveryStartedAt).toEqual(DAY_0);
    expect(world.emails.sent).toEqual([]);
  });

  /** @scenario "A redelivered payment failure event changes nothing" */
  it("changes nothing when the identical event is delivered again", async () => {
    const world = setUp();
    await world.service.paymentFailed({ invoice: RENEWAL });
    const before = { ...world.row() };

    await world.service.paymentFailed({ invoice: RENEWAL });

    expect(world.row()).toEqual(before);
    expect(world.emails.sent).toEqual([]);
  });
});

describe("given an open recovery case", () => {
  let world: ReturnType<typeof setUp>;
  beforeEach(async () => {
    world = setUp();
    await world.service.paymentFailed({ invoice: RENEWAL });
    world.emails.sent.length = 0;
  });

  describe.each([
    [3, "failed"],
    [7, "reminder"],
  ] as const)("when the sweep runs on day %i", (day, kind) => {
    /** @scenario "An email goes out on day <day> with the Free plan date" */
    it(`sends the ${kind} email once to the admins and the billing member`, async () => {
      if (day === 7) {
        world.at(dayOf(3));
        await world.service.sweep();
        world.emails.sent.length = 0;
      }
      world.at(dayOf(day, 2));

      await world.service.sweep();
      await world.service.sweep();

      expect(world.emails.sent.map((sent) => sent.to).toSorted()).toEqual([
        "ana@acme.test",
        "bo@acme.test",
        "cy@acme.test",
      ]);
      expect(world.kinds()).toEqual([kind, kind, kind]);
      expect(world.emails.sent[0]!.email).toMatchObject({
        organizationName: "ACME",
        amount: "€280.72",
        invoiceNumber: "LW-0042",
        accessStopsOn: "23 November 2026",
        card: { brand: "Visa", last4: "4242" },
        actionUrl: `${BASE}/settings/subscription?updateCard=1`,
      });
      expect(world.row().paymentRecoveryNoticeDay).toBe(day);
    });
  });

  describe("when the sweep runs on day 14", () => {
    /** @scenario "A final warning goes out on day 14 with the Free plan limits" */
    it("sends the final warning once with the Free plan limits and a pay link", async () => {
      world.at(dayOf(14, 1));

      await world.service.sweep();
      await world.service.sweep();

      expect(world.kinds()).toEqual(["final", "final", "final"]);
      expect(world.emails.sent[0]!.email).toMatchObject({
        freeLimits: { eventsPerMonth: expect.any(Number), eachOfScenarios: expect.any(Number) },
        actionUrl: `${BASE}/settings/subscription?pay=1`,
      });
    });
  });

  describe("when a sweep missed day 7 and runs on day 8", () => {
    /** @scenario "A sweep that missed a day sends only the latest reminder due" */
    it("sends only the day 7 reminder", async () => {
      world.at(dayOf(3));
      await world.service.sweep();
      world.emails.sent.length = 0;
      world.at(dayOf(8));

      await world.service.sweep();

      expect(world.kinds()).toEqual(["reminder", "reminder", "reminder"]);
      expect(world.row().paymentRecoveryNoticeDay).toBe(7);
    });
  });

  describe("when the sweep runs again the same day", () => {
    /** @scenario "Two sweeps on the same day send a reminder once" */
    it("sends no second reminder", async () => {
      world.at(dayOf(7, 1));
      const first = await world.service.sweep();
      world.at(dayOf(7, 5));

      const second = await world.service.sweep();

      expect(first.notified).toBe(1);
      expect(second.notified).toBe(0);
      expect(world.emails.sent).toHaveLength(3);
    });
  });

  describe("when the mail provider refuses one address", () => {
    /** @scenario "A reminder that fails to send for one person still reaches the others" */
    it("reaches the other two and counts the reminder as sent", async () => {
      world.emails.refused.add("bo@acme.test");
      world.at(dayOf(3));

      const outcome = await world.service.sweep();

      expect(world.emails.sent.map((sent) => sent.to).toSorted()).toEqual([
        "ana@acme.test",
        "cy@acme.test",
      ]);
      expect(outcome).toEqual({ notified: 1, closed: 0, failed: 0 });
      expect(world.row().paymentRecoveryNoticeDay).toBe(3);
    });
  });

  describe("when the organization has nobody with a deliverable address", () => {
    /** @scenario "A reminder with nobody to send to is recorded, not retried forever" */
    it("records the reminder as sent and goes on", async () => {
      world.store.members.length = 0;
      world.at(dayOf(3));

      const outcome = await world.service.sweep();

      expect(outcome.notified).toBe(1);
      expect(world.row().paymentRecoveryNoticeDay).toBe(3);
      expect(world.emails.sent).toHaveLength(0);
    });
  });

  describe("when the sweep runs twice after day 21", () => {
    /** @scenario "The paused email goes out once on day 21" */
    it("sends one paused email per person with the pay link", async () => {
      world.at(dayOf(21, 1));

      await world.service.sweep();
      await world.service.sweep();

      expect(world.kinds()).toEqual(["paused", "paused", "paused"]);
      expect(world.emails.sent[0]!.email.actionUrl).toBe(`${BASE}/settings/subscription?pay=1`);
      expect(await world.service.summary({ organizationId: "org_1" })).toEqual({
        state: "paused",
      });
    });
  });

  describe.each([
    ["day 0", 0],
    ["day 5, after the first email", 5],
    ["day 21, while paused", 21],
    ["day 40, while paused", 40],
  ])("when Stripe reports the invoice paid on %s", (_stage, day) => {
    /** @scenario "Paying the invoice on <stage> restores the paid plan at once" */
    it("closes the case and sends no further notice", async () => {
      world.at(dayOf(day));
      await world.service.sweep();
      world.emails.sent.length = 0;

      await world.service.invoicePaid({ invoice: RENEWAL });
      world.at(dayOf(day + 3));
      await world.service.sweep();

      expect(await world.recoveries.findOpen()).toEqual([]);
      expect(world.row().paymentRecoveryStartedAt).toBeNull();
      const restored = day === 0 ? [] : ["restored", "restored", "restored"];
      expect(world.kinds()).toEqual(restored);
      expect(await world.service.summary({ organizationId: "org_1" })).toEqual({ state: "none" });
    });
  });

  describe("when the invoice is paid on day 2, before any email", () => {
    /** @scenario "A payment that settles before day 3 sends no email at all" */
    it("closes the case and mails nobody", async () => {
      world.at(dayOf(2));

      await world.service.invoicePaid({ invoice: RENEWAL });
      world.at(dayOf(3));
      await world.service.sweep();

      expect(await world.recoveries.findOpen()).toEqual([]);
      expect(world.emails.sent).toEqual([]);
    });
  });

  describe("when the invoice is paid after the day 3 email", () => {
    beforeEach(async () => {
      world.at(dayOf(3));
      await world.service.sweep();
      world.emails.sent.length = 0;
      world.at(dayOf(4));
    });

    /** @scenario "Every recovery after an email sends one restored email" */
    it("sends one restored email per person, linking the app", async () => {
      await world.service.invoicePaid({ invoice: RENEWAL });

      expect(world.emails.sent).toHaveLength(3);
      expect(world.emails.sent[0]!.email).toMatchObject({
        kind: "restored",
        planName: expect.any(String),
        actionUrl: BASE,
      });
    });

    /** @scenario "Both paid events of one invoice close the case once" */
    it("changes nothing on the second paid event of the same invoice", async () => {
      await world.service.invoicePaid({ invoice: RENEWAL });
      await world.service.invoicePaid({ invoice: RENEWAL });

      expect(world.emails.sent).toHaveLength(3);
    });
  });

  describe("when a separate seat change invoice is paid", () => {
    /** @scenario "A paid invoice for a different invoice leaves the case open" */
    it("keeps the case open with its Free plan date", async () => {
      await world.service.invoicePaid({
        invoice: { ...RENEWAL, id: "in_seat_change", billingReason: "subscription_update" },
      });

      expect(world.row().paymentRecoveryInvoiceId).toBe("in_renewal");
      expect(world.row().paymentRecoveryStartedAt).toEqual(DAY_0);
      expect(world.emails.sent).toHaveLength(0);
    });
  });

  describe("when the card is updated and no charge has succeeded yet", () => {
    /** @scenario "A new card alone does not close the case" */
    it("keeps the case open while Stripe still answers the invoice open", async () => {
      world.at(dayOf(3));

      await world.service.sweep();

      expect(await world.recoveries.findOpen()).toHaveLength(1);
      expect(world.kinds()).toEqual(["failed", "failed", "failed"]);
    });
  });

  describe("when the invoice is voided or marked uncollectible", () => {
    /** @scenario "An invoice voided or marked uncollectible by staff closes the case" */
    it("closes the case silently and sends no further reminder", async () => {
      await world.service.invoiceClosedUnpaid({ invoice: RENEWAL });
      world.at(dayOf(7));
      await world.service.sweep();

      expect(world.row()).toMatchObject({ status: "ACTIVE", paymentRecoveryStartedAt: null });
      expect(world.emails.sent).toHaveLength(0);
    });

    it("closes a case whose void event never arrived on the next sweep", async () => {
      world.settle("void");
      world.at(dayOf(3));

      expect(await world.service.sweep()).toEqual({ notified: 0, closed: 1, failed: 0 });
      expect(world.emails.sent).toHaveLength(0);
    });

    it("closes a case whose paid event never arrived with one restored email", async () => {
      world.at(dayOf(3));
      await world.service.sweep();
      world.emails.sent.length = 0;
      world.settle("paid");
      world.at(dayOf(4));

      await world.service.sweep();

      expect(world.kinds()).toEqual(["restored", "restored", "restored"]);
    });
  });

  describe("when the pay link's invoice page cannot be read", () => {
    /** @scenario "A pay link that cannot be created falls back to the billing page" */
    it("answers the billing page as a fallback", async () => {
      expect(await world.service.payLink({ organizationId: "org_1" })).toEqual({
        url: "https://invoice.stripe.test/in_renewal",
        isFallback: false,
      });
      world.invoices.refuse({ operation: "getInvoice", error: new Error("Stripe is down") });

      expect(await world.service.payLink({ organizationId: "org_1" })).toEqual({
        url: `${BASE}/settings/subscription`,
        isFallback: true,
      });
    });
  });
});

describe("given an organization on the Enterprise plan", () => {
  /** @scenario "An enterprise organization's failed payment never pauses it" */
  it("opens no case, sends no email and alerts the account team", async () => {
    const world = setUp({ plan: "ENTERPRISE" });

    await world.service.paymentFailed({ invoice: RENEWAL });

    expect(await world.recoveries.findOpen()).toEqual([]);
    expect(world.emails.sent).toEqual([]);
    expect(world.alerts).toEqual([
      expect.objectContaining({ organizationId: "org_1", stripeInvoiceId: "in_renewal" }),
    ]);
  });
});

describe("given payment failures recovery does not own", () => {
  /** @scenario "An organization billed by invoice is never paused" */
  it("ignores an invoice collected by sending it", async () => {
    const world = setUp();

    await world.service.paymentFailed({
      invoice: { ...RENEWAL, collectionMethod: "send_invoice" },
    });

    expect(await world.recoveries.findOpen()).toEqual([]);
  });

  /** @scenario "A connected self-hosted customer's failed payment is not cloud recovery" */
  it("ignores an invoice with no cloud subscription", async () => {
    const world = setUp();

    await world.service.paymentFailed({ invoice: { ...RENEWAL, subscriptionId: null } });

    expect(await world.recoveries.findOpen()).toEqual([]);
    expect(world.emails.sent).toEqual([]);
  });

  /** @scenario "A first checkout that fails is not a recovery case" */
  it("ignores a first checkout's invoice", async () => {
    const world = setUp();

    await world.service.paymentFailed({
      invoice: { ...RENEWAL, billingReason: "subscription_create" },
    });

    expect(await world.recoveries.findOpen()).toEqual([]);
  });

  /** @scenario "A payment failure for an unknown subscription is acknowledged" */
  it("acknowledges a subscription it has no record of", async () => {
    const world = setUp();

    await expect(
      world.service.paymentFailed({ invoice: { ...RENEWAL, subscriptionId: "sub_unknown" } }),
    ).resolves.toBeUndefined();
    expect(await world.recoveries.findOpen()).toEqual([]);
  });
});

describe("given a database that cannot be reached", () => {
  /** @scenario "A database failure while opening a case makes Stripe retry" */
  it("fails the delivery, and the redelivery opens the case", async () => {
    const world = setUp();
    world.recoveries.refuseOnce({ operation: "open", error: new Error("connection refused") });

    await expect(world.service.paymentFailed({ invoice: RENEWAL })).rejects.toThrow(
      "connection refused",
    );
    await world.service.paymentFailed({ invoice: RENEWAL });

    expect(await world.recoveries.findOpen()).toHaveLength(1);
    expect(world.emails.sent).toEqual([]);
  });

  describe("when the people who can pay cannot be read during a sweep", () => {
    /** @scenario "A reminder whose recipients cannot be read goes out on the next sweep" */
    it("leaves the reminder unsent, and the next sweep sends it once", async () => {
      const world = setUp();
      await world.service.paymentFailed({ invoice: RENEWAL });
      world.emails.sent.length = 0;
      world.at(dayOf(3));
      world.refuseBillingMembersOnce();

      const first = await world.service.sweep();

      expect(first).toEqual({ notified: 0, closed: 0, failed: 1 });
      expect(world.row().paymentRecoveryNoticeDay).toBeNull();
      expect(world.emails.sent).toHaveLength(0);

      const second = await world.service.sweep();

      expect(second.notified).toBe(1);
      expect(world.row().paymentRecoveryNoticeDay).toBe(3);
      expect(world.kinds()).toEqual(["failed", "failed", "failed"]);
    });
  });

  describe("when the people who can pay cannot be read on the paid event", () => {
    /** @scenario "A paid event whose recipients cannot be read makes Stripe retry" */
    it("fails the delivery with the case open, and the redelivery restores once", async () => {
      const world = setUp();
      await world.service.paymentFailed({ invoice: RENEWAL });
      world.at(dayOf(3));
      await world.service.sweep();
      world.emails.sent.length = 0;
      world.refuseBillingMembersOnce();

      await expect(world.service.invoicePaid({ invoice: RENEWAL })).rejects.toThrow(
        "authorization is unreachable",
      );
      expect(await world.recoveries.findOpen()).toHaveLength(1);

      await world.service.invoicePaid({ invoice: RENEWAL });

      expect(await world.recoveries.findOpen()).toEqual([]);
      expect(world.kinds()).toEqual(["restored", "restored", "restored"]);
    });
  });
});

describe("given an organization paused on day 21 whose paid event never arrived", () => {
  /** @scenario "A paused case whose paid event never arrived closes on the next sweep" */
  it("closes the case on the next sweep with one restored email", async () => {
    const world = setUp();
    await world.service.paymentFailed({ invoice: RENEWAL });
    world.at(dayOf(21, 1));
    await world.service.sweep();
    expect(await world.service.summary({ organizationId: "org_1" })).toEqual({ state: "paused" });
    world.emails.sent.length = 0;
    world.settle("paid");
    world.at(dayOf(25));

    const outcome = await world.service.sweep();
    await world.service.sweep();

    expect(outcome).toEqual({ notified: 0, closed: 1, failed: 0 });
    expect(await world.recoveries.findOpen()).toEqual([]);
    expect(await world.service.summary({ organizationId: "org_1" })).toEqual({ state: "none" });
    expect(world.kinds()).toEqual(["restored", "restored", "restored"]);
  });
});

describe("given an organization with an older open case on another subscription", () => {
  /** @scenario "The first email belongs to the subscription that failed" */
  it("records the day 3 email on the failing subscription and the older case's own notice on it", async () => {
    const world = setUp();
    world.store.subscriptions.push({
      ...world.row(),
      id: "sub_db_old",
      stripeSubscriptionId: "sub_stripe_old",
    });
    world.invoices.seed({
      invoice: {
        id: "in_old",
        customerId: "cus_1",
        number: "LW-0041",
        created: dayOf(-4).epochMilliseconds / 1000,
        amountDue: RENEWAL.amountDue,
        currency: RENEWAL.currency,
        status: "open",
        pdfUrl: null,
        hostedUrl: null,
      },
      card: null,
    });
    await world.recoveries.open({
      subscriptionId: "sub_db_old",
      invoiceId: "in_old",
      startedAt: dayOf(-4),
    });
    await world.recoveries.advanceNotice({ subscriptionId: "sub_db_old", from: null, to: 3 });

    await world.service.paymentFailed({ invoice: RENEWAL });
    world.at(dayOf(3, 1));
    await world.service.sweep();

    expect(world.row().paymentRecoveryNoticeDay).toBe(3);
    expect(world.store.subscriptions[1]).toMatchObject({
      paymentRecoveryInvoiceId: "in_old",
      paymentRecoveryNoticeDay: 7,
    });
    expect(world.kinds().toSorted()).toEqual([
      "failed",
      "failed",
      "failed",
      "reminder",
      "reminder",
      "reminder",
    ]);
  });
});
