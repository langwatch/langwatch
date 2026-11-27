/**
 * Seat requests as `OrganizationModule.create` composes them over the memory registry: the one
 * organization (Ada admin, Bill member and Billing) every seat request suite starts from.
 */
import type { AuthzApi } from "@langwatch/authz-contract";
import type { BillingApi, SeatPayment } from "@langwatch/enterprise-billing-contract";
import type { EntitlementApi, Plan } from "@langwatch/entitlement-contract";
import type { NotificationService } from "@langwatch/notification-contract";
import { OrganizationUserRole, type OrganizationCaller } from "@langwatch/organization-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { nowInstant } from "@langwatch/time";

import type { MemoryAccessNoticeMailChannel } from "../../../channels/memory/memory.access-notice-mail.channel.ts";
import type { MemoryAccessNoticePushChannel } from "../../../channels/memory/memory.access-notice-push.channel.ts";
import { MemoryOrganizationDatabase } from "../../../repositories/memory/memory.organization.database.ts";
import { MemorySeatRequestRepository } from "../../../repositories/memory/memory.seat-request.repository.ts";
import type { OrganizationLifecycleSenders } from "../../../services/organization-lifecycle-notice.service.ts";
import { OrganizationModule } from "../../organization.app.ts";
import { organizationModuleSetup } from "./organization-module-setup.ts";

export const ORGANIZATION_ID = "org-acme";
export const PROJECT_ID = "project-acme";
export const ADA: OrganizationCaller = {
  id: "user-ada",
  name: "Ada Admin",
  email: "ada@acme.example",
};
export const BILL = { id: "user-bill", name: "Bill Payer", email: "bill@acme.example" };

/** Ada (admin) and Bill (member) take two full seats; `freeFull` and `freeLite` add room. */
export function planWith({
  freeFull = 0,
  freeLite = 0,
  plan = {},
}: {
  freeFull?: number;
  freeLite?: number;
  plan?: Partial<Plan>;
}): Plan {
  return {
    planSource: "free",
    type: "free",
    name: "Free",
    free: true,
    maxMembers: 2 + freeFull,
    maxMembersLite: freeLite,
    maxMembersDeveloper: 0,
    maxMessagesPerMonth: 1_000_000,
    canPublish: true,
    prices: { USD: 0, EUR: 0 },
    ...plan,
  };
}

type SalesNotice = Parameters<BillingApi["notifySalesOfSeatRequest"]>[0];

/** The plan of an organization paying per seat through a live Stripe subscription. */
export const STRIPE_SEAT_PLAN: Partial<Plan> = {
  planSource: "subscription",
  type: "GROWTH_SEAT_EVENT",
  name: "Growth",
  free: false,
};

/** How billing answers a seat purchase: added at once, or a Stripe page the customer finishes. */
export type SeatBilling = {
  purchase: "added" | "payment_required";
  /** How the Stripe page stands when the approval is completed. */
  payment: "paid" | "open" | "failed";
  purchases: number;
  /** Every payment billing was asked to settle, in order. */
  settled: SeatPayment[];
  /** Runs while a purchase is under way, before billing answers. */
  duringPurchase?: () => Promise<void>;
  /** Runs while billing reads whether the seat payment landed, before it answers. */
  duringSettle?: () => Promise<void>;
};

export async function application(
  options: {
    freeFull?: number;
    freeLite?: number;
    plan?: Partial<Plan>;
    isSaas?: boolean;
    /** The notice log is down, so no access notice can be recorded. */
    noticesDown?: boolean;
    /** Billing's sales notice fails, as a peer outage would. */
    salesDown?: boolean;
    /** The seat an arrival joins on; a full Member seat unless named. */
    joinerRole?: "MEMBER" | "DEVELOPER";
    /** Whether the organization has its one project, the tenant pushes are recorded on. */
    withProject?: boolean;
  } = {},
) {
  const memory = MemoryOrganizationDatabase.create();
  const state = { plan: planWith(options) };
  const salesNotices: SalesNotice[] = [];
  /** Whether billing's sales notice goes out; a test may bring it back up. */
  const sales = { down: options.salesDown ?? false };
  const seatBilling: SeatBilling = {
    purchase: "added",
    payment: "paid",
    purchases: 0,
    settled: [],
  };
  const addSeat = () => {
    state.plan = { ...state.plan, maxMembers: state.plan.maxMembers + 1 };
  };
  const setup = organizationModuleSetup({
    memory,
    permissions: createApiFixture<AuthzApi>(
      {
        findPermissionsBeyondCaller: async () => [],
        listBillingMembers: async () => [{ userId: BILL.id }],
        invalidateOrganization: async () => {},
      },
      "AuthzApi",
    ),
    entitlement: createApiFixture<EntitlementApi>(
      { getActivePlan: async () => state.plan, requestBound: async () => 1_000 },
      "EntitlementApi",
    ),
    notifications: createApiFixture<NotificationService>({}, "NotificationService"),
    billing: createApiFixture<BillingApi>(
      {
        notifySalesOfSeatRequest: async (input: SalesNotice) => {
          if (sales.down) return { sent: false };
          salesNotices.push(input);
          return { sent: true };
        },
        addFullSeat: async () => {
          seatBilling.purchases += 1;
          const during = seatBilling.duringPurchase;
          seatBilling.duringPurchase = undefined;
          await during?.();
          if (seatBilling.purchase === "added") {
            addSeat();
            return { status: "added" as const };
          }
          return {
            status: "payment_required" as const,
            payment: { kind: "invoice" as const, invoiceId: "in_seat", seats: 3 },
            url: "https://invoice.stripe.example/in_seat",
          };
        },
        settleSeatPayment: async ({ payment }) => {
          seatBilling.settled.push(payment);
          const during = seatBilling.duringSettle;
          seatBilling.duringSettle = undefined;
          await during?.();
          if (seatBilling.payment === "paid") addSeat();
          return { status: seatBilling.payment };
        },
      },
      "BillingApi",
    ),
  });
  for (const person of [ADA, BILL]) {
    memory.users.set(person.id, {
      id: person.id,
      name: person.name ?? null,
      email: person.email ?? null,
      deactivatedAt: null,
    });
  }
  await setup.repositories.membership(setup.dependencies.permissions).createAndAssign({
    userId: ADA.id,
    orgId: ORGANIZATION_ID,
    orgName: "ACME",
    orgSlug: "acme",
    teamId: "team-acme",
    teamSlug: "engineering",
    pricingModel: "SEAT_EVENT",
  });
  if (options.withProject ?? true) {
    memory.projects.set(PROJECT_ID, {
      id: PROJECT_ID,
      name: "Support agent",
      slug: "support-agent",
      apiKey: "",
      teamId: "team-acme",
      isPersonal: false,
      ownerUserId: null,
      organizationId: ORGANIZATION_ID,
      archivedAt: null,
      createdAt: nowInstant(),
      updatedAt: nowInstant(),
      personalFeatures: null,
    });
  }
  memory.organizationUsers.push({
    userId: BILL.id,
    organizationId: ORGANIZATION_ID,
    role: OrganizationUserRole.MEMBER,
    disabledAt: null,
    createdAt: nowInstant(),
    updatedAt: nowInstant(),
  });
  if (options.joinerRole) {
    const organization = memory.organizations.get(ORGANIZATION_ID);
    if (organization) organization.joinerRole = options.joinerRole;
  }
  if (options.noticesDown) {
    setup.repositories.accessNotices.record = async () => {
      throw new Error("notice log unavailable");
    };
  }
  const app = await OrganizationModule.create({
    ...setup,
    config: { ...setup.config, isSaas: options.isSaas ?? false },
  });
  app.connectLifecycle(
    createApiFixture<OrganizationLifecycleSenders>({
      recordMemberEnabled: { send: async () => {} },
      recordMemberRemoved: { send: async () => {} },
    }),
  );
  const mail = setup.channels.accessNoticeMail as MemoryAccessNoticeMailChannel;
  const push = setup.channels.accessNoticePush as MemoryAccessNoticePushChannel;

  /** A person signing in by single sign-on, asking for `seat`. */
  async function arrive({
    email,
    seat = "MEMBER",
  }: {
    email: string;
    seat?: "MEMBER" | "DEVELOPER";
  }) {
    const userId = `user-${email.split("@")[0]}`;
    memory.users.set(userId, { id: userId, name: null, email, deactivatedAt: null });
    const admission = await app.createMembership({ organizationId: ORGANIZATION_ID, userId, seat });
    return { userId, admission };
  }

  /** A Lite Member already in the organization, with no seat request on file. */
  function liteMember({ email, name = null }: { email: string; name?: string | null }) {
    const userId = `user-${email.split("@")[0]}`;
    memory.users.set(userId, { id: userId, name, email, deactivatedAt: null });
    memory.organizationUsers.push({
      userId,
      organizationId: ORGANIZATION_ID,
      role: OrganizationUserRole.EXTERNAL,
      disabledAt: null,
      createdAt: nowInstant(),
      updatedAt: nowInstant(),
    });
    const caller: OrganizationCaller = { id: userId, name, email };
    return { userId, caller };
  }

  const membershipOf = (userId: string) =>
    memory.organizationUsers.find(
      (row) => row.userId === userId && row.organizationId === ORGANIZATION_ID,
    );
  const openRequests = async () =>
    (await app.listOpenSeatRequests({ organizationId: ORGANIZATION_ID })).requests;

  /** The seat request rows, whose writes a test may make fail. */
  const seatRequests = setup.repositories.seatRequests;
  if (!(seatRequests instanceof MemorySeatRequestRepository)) {
    throw new Error("the seat request fixture runs on the memory repository");
  }

  return {
    app,
    memory,
    state,
    mail,
    push,
    salesNotices,
    sales,
    seatRequests,
    seatBilling,
    arrive,
    liteMember,
    membershipOf,
    openRequests,
  };
}
