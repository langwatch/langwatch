/**
 * @vitest-environment node
 * The `subscription.*` surface: the eight names the billing page calls, the
 * permission each is behind, and the two-step every checkout is.
 */
import { bindTrpcFact, createTrpcRuntime } from "@langwatch/api/trpc";
import { initTRPC } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  billingCallerEmailFact,
  subscriptionTrpcTransport,
  type BillingSubscriptionApi,
} from "../subscription.trpc.ts";
import { billingTrpcTestPorts, type BillingTrpcTestContext } from "./billing.trpc.harness.ts";

const ORGANIZATION = "org_acme";
const CUSTOMER = "cus_acme";

const getOrCreateCustomerId = vi.fn<BillingSubscriptionApi["getOrCreateCustomerId"]>();
const updateSubscriptionItems = vi.fn<BillingSubscriptionApi["updateSubscriptionItems"]>();
const createOrUpdateSubscription = vi.fn<BillingSubscriptionApi["createOrUpdateSubscription"]>();
const createBillingPortalSession = vi.fn<BillingSubscriptionApi["createBillingPortalSession"]>();
const findLastNonCancelledSubscription =
  vi.fn<BillingSubscriptionApi["findLastNonCancelledSubscription"]>();
const previewProration = vi.fn<BillingSubscriptionApi["previewProration"]>();
const notifyProspective = vi.fn<BillingSubscriptionApi["notifyProspective"]>();
const createSubscriptionWithInvites =
  vi.fn<BillingSubscriptionApi["createSubscriptionWithInvites"]>();
const listInvoices = vi.fn<BillingSubscriptionApi["listInvoices"]>();

const billing: BillingSubscriptionApi = {
  getOrCreateCustomerId,
  updateSubscriptionItems,
  createOrUpdateSubscription,
  createBillingPortalSession,
  findLastNonCancelledSubscription,
  previewProration,
  notifyProspective,
  createSubscriptionWithInvites,
  listInvoices,
};

const trpc = initTRPC.context<BillingTrpcTestContext>().create();

function routerFor(permits: (permission: string) => boolean = () => true) {
  return createTrpcRuntime<BillingTrpcTestContext>({
    root: trpc,
    procedure: trpc.procedure,
    ports: billingTrpcTestPorts(permits),
  }).mount(subscriptionTrpcTransport, () => billing, {
    // The address is the PROCESS's to resolve, off the session it authenticated.
    facts: [bindTrpcFact(billingCallerEmailFact, (ctx) => ctx.email ?? null)],
  });
}

const router = routerFor();

function callerWith(email: string | null) {
  return router.createCaller({ actor: { id: "user_ana" }, email });
}

const caller = callerWith("ana@acme.com");

beforeEach(() => {
  vi.clearAllMocks();
  getOrCreateCustomerId.mockResolvedValue(CUSTOMER);
});

describe("given the mounted subscription router", () => {
  describe("when its procedures are read", () => {
    it("exposes exactly the names the billing page calls", () => {
      expect(Object.keys(router._def.procedures).sort()).toEqual([
        "addTeamMemberOrEvents",
        "create",
        "getLastSubscription",
        "listInvoices",
        "manage",
        "previewProration",
        "prospective",
        "upgradeWithInvites",
      ]);
    });

    it("reads with queries and changes what is paid with mutations", () => {
      const kinds = Object.fromEntries(
        Object.entries(router._def.procedures).map(([name, procedure]) => [
          name,
          (procedure as { _def: { type: string } })._def.type,
        ]),
      );

      expect(kinds).toEqual({
        addTeamMemberOrEvents: "mutation",
        create: "mutation",
        getLastSubscription: "query",
        listInvoices: "query",
        manage: "mutation",
        previewProration: "query",
        prospective: "mutation",
        upgradeWithInvites: "mutation",
      });
    });
  });
});

describe("given a caller who may read the organization but not manage it", () => {
  describe("when a change to what the organization pays is asked for", () => {
    it("refuses the change and still answers the read", async () => {
      const viewer = routerFor((permission) => permission === "organization:view").createCaller({
        actor: { id: "user_ana" },
        email: "ana@acme.com",
      });

      listInvoices.mockResolvedValue([]);

      await expect(
        viewer.create({ organizationId: ORGANIZATION, baseUrl: "https://app", plan: "PRO" }),
      ).rejects.toMatchObject({ cause: { code: "permission_denied" } });
      await expect(viewer.listInvoices({ organizationId: ORGANIZATION })).resolves.toEqual([]);
      expect(createOrUpdateSubscription).not.toHaveBeenCalled();
    });
  });
});

describe("when a first checkout is started", () => {
  it("resolves the provider customer from the caller's own address first", async () => {
    createOrUpdateSubscription.mockResolvedValue({ url: "https://checkout" });

    await expect(
      caller.create({
        organizationId: ORGANIZATION,
        baseUrl: "https://app",
        plan: "PRO",
        membersToAdd: 3,
        currency: "EUR",
        billingInterval: "annual",
      }),
    ).resolves.toEqual({ url: "https://checkout" });

    expect(getOrCreateCustomerId).toHaveBeenCalledWith({
      user: { email: "ana@acme.com" },
      organizationId: ORGANIZATION,
    });
    expect(createOrUpdateSubscription).toHaveBeenCalledWith({
      organizationId: ORGANIZATION,
      baseUrl: "https://app",
      plan: "PRO",
      customerId: CUSTOMER,
      membersToAdd: 3,
      currency: "EUR",
      billingInterval: "annual",
    });
  });
});

describe("when the billing portal is opened", () => {
  it("opens it against the same customer the checkout would use", async () => {
    createBillingPortalSession.mockResolvedValue({ url: "https://portal" });

    await expect(
      caller.manage({ organizationId: ORGANIZATION, baseUrl: "https://app" }),
    ).resolves.toEqual({ url: "https://portal" });

    expect(createBillingPortalSession).toHaveBeenCalledWith({
      customerId: CUSTOMER,
      baseUrl: "https://app",
      organizationId: ORGANIZATION,
    });
  });
});

describe("when seats are bought for people who are not members yet", () => {
  it("carries the invitations through the same checkout", async () => {
    createSubscriptionWithInvites.mockResolvedValue({ url: "https://checkout" });

    await caller.upgradeWithInvites({
      organizationId: ORGANIZATION,
      baseUrl: "https://app",
      totalSeats: 4,
      invites: [{ email: "bo@acme.com", role: "MEMBER" }],
    });

    expect(createSubscriptionWithInvites).toHaveBeenCalledWith({
      organizationId: ORGANIZATION,
      baseUrl: "https://app",
      membersToAdd: 4,
      customerId: CUSTOMER,
      invites: [{ email: "bo@acme.com", role: "MEMBER" }],
    });
  });
});

describe("when the seat and volume lines are raised on a live subscription", () => {
  it("prices the change at the instant the customer was quoted", async () => {
    updateSubscriptionItems.mockResolvedValue({ success: true });

    await expect(
      caller.addTeamMemberOrEvents({
        organizationId: ORGANIZATION,
        plan: "GROWTH",
        upgradeMembers: true,
        upgradeTraces: false,
        totalMembers: 9,
        totalTraces: 0,
        quotedAt: 1_700_000_000,
      }),
    ).resolves.toEqual({ success: true });

    expect(updateSubscriptionItems).toHaveBeenCalledWith({
      organizationId: ORGANIZATION,
      plan: "GROWTH",
      upgradeMembers: true,
      upgradeTraces: false,
      totalMembers: 9,
      totalTraces: 0,
      quotedAt: 1_700_000_000,
    });
    // No customer is resolved for a subscription that already exists.
    expect(getOrCreateCustomerId).not.toHaveBeenCalled();
  });
});

describe("when the most recent subscription is read", () => {
  it("answers the provider's own object, and nothing where there is none", async () => {
    findLastNonCancelledSubscription.mockResolvedValue({ id: "sub_1", status: "active" });

    await expect(caller.getLastSubscription({ organizationId: ORGANIZATION })).resolves.toEqual({
      id: "sub_1",
      status: "active",
    });

    findLastNonCancelledSubscription.mockResolvedValue(null);

    await expect(caller.getLastSubscription({ organizationId: ORGANIZATION })).resolves.toBeNull();
  });
});

describe("when a seat change is quoted before it is confirmed", () => {
  it("answers the quote unchanged, so the charge can reproduce it", async () => {
    previewProration.mockResolvedValue({ amountDueCents: 4200, quotedAt: 1_700_000_000 });

    await expect(
      caller.previewProration({ organizationId: ORGANIZATION, newTotalSeats: 6 }),
    ).resolves.toEqual({ amountDueCents: 4200, quotedAt: 1_700_000_000 });
  });
});

describe("when sales is told an organization asked about a negotiated plan", () => {
  it("names the caller's own address on the notice", async () => {
    notifyProspective.mockResolvedValue({ delivered: true });

    await caller.prospective({
      organizationId: ORGANIZATION,
      plan: "ACCELERATE",
      note: "60 seats",
    });

    expect(notifyProspective).toHaveBeenCalledWith({
      organizationId: ORGANIZATION,
      plan: "ACCELERATE",
      actorEmail: "ana@acme.com",
      note: "60 seats",
    });
  });

  describe("given a caller the process resolved no address for", () => {
    it("refuses with the code the account page writes its copy against", async () => {
      await expect(
        callerWith(null).prospective({ organizationId: ORGANIZATION, plan: "ACCELERATE" }),
      ).rejects.toMatchObject({ cause: { code: "billing_customer_email_required" } });
      expect(notifyProspective).not.toHaveBeenCalled();
    });
  });
});

describe("when the billing page lists invoices", () => {
  it("answers the organization's own invoices", async () => {
    const invoice = {
      id: "in_1",
      number: "0001",
      date: 1_700_000_000,
      amountDue: 4200,
      currency: "eur",
      status: "paid",
      pdfUrl: null,
      hostedUrl: null,
    };
    listInvoices.mockResolvedValue([invoice]);

    await expect(caller.listInvoices({ organizationId: ORGANIZATION })).resolves.toEqual([invoice]);
    expect(listInvoices).toHaveBeenCalledWith({ organizationId: ORGANIZATION });
  });
});
