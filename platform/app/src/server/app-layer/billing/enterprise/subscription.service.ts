import type Stripe from "stripe";
import {
  BillingSubscriptionService,
  type BillingSubscriptionNotifierPort,
  PostgresBillingAdapter,
  type BillingSubscriptionRepository,
  type BillingOrganizationPort,
} from "@langwatch/enterprise-billing-server";
import type { PrismaClient, Subscription } from "~/generated/prisma/client";
import { getApp } from "../../app";
import type { OrganizationRepository } from "~/server/app-layer/organizations/repositories/organization.repository";
import type { SubscriptionRepository } from "~/server/app-layer/subscription/subscription.repository";
import type {
  DisplayInvoice,
  SubscriptionService,
} from "~/server/app-layer/subscription/subscription.service";
import { traced } from "~/server/app-layer/tracing";

export const RECENT_INVOICES_LIMIT = 4;

type ItemCalculator = {
  getItemsToUpdate: (...args: any[]) => any;
  createItemsToAdd: (...args: any[]) => any;
  readonly prices: Record<string, string>;
};

const toBillingRepository = (
  repository: SubscriptionRepository,
): BillingSubscriptionRepository =>
  ({
    tryFindActive: async () => null,
    tryFindLastNonCancelled: (organizationId) =>
      repository.findLastNonCancelled(organizationId) as any,
    createPending: async (input) => (await repository.createPending(input)) as any,
    updateStatus: async (input) => (await repository.updateStatus(input)) as any,
    updatePlan: async (input) => (await repository.updatePlan(input)) as any,
    tryFindByStripeId: (stripeSubscriptionId) =>
      repository.findByStripeId(stripeSubscriptionId) as any,
    linkStripeId: (input) => repository.linkStripeId(input),
    activate: async (input) => (await repository.activate(input)) as any,
    recordPaymentFailure: (input) => repository.recordPaymentFailure(input),
    cancel: (input) => repository.cancel(input),
    cancelTrialSubscriptions: (organizationId) =>
      repository.cancelTrialSubscriptions(organizationId),
    migrateToSeatEvent: (input) => repository.migrateToSeatEvent(input),
    updateQuantities: async (input) => (await repository.updateQuantities(input)) as any,
  }) as BillingSubscriptionRepository;

const toBillingOrganizationRepository = (
  repository: OrganizationRepository,
): BillingOrganizationPort =>
  ({
    tryGetPricingModel: (organizationId) => repository.getPricingModel(organizationId),
    tryGetStripeCustomerId: (organizationId) =>
      repository.getStripeCustomerId(organizationId),
    tryFindName: (organizationId) => repository.findNameById(organizationId),
    tryFindFirstTeamId: async () => null,
  }) as BillingOrganizationPort;

const createNotifier = (): BillingSubscriptionNotifierPort => ({
  send: async (payload) => {
    await getApp().notifications.sendSlackSubscriptionEvent(payload);
  },
});

/** Thin app composition adapter; the enterprise implementation is packaged. */
export class EESubscriptionService implements SubscriptionService {
  private constructor(
    private readonly service: BillingSubscriptionService,
    private readonly legacyRepository: SubscriptionRepository,
  ) {}

  static createWithDependencies(options: {
    prisma: PrismaClient;
    repository: SubscriptionRepository;
    stripe: Stripe;
    itemCalculator: ItemCalculator;
    organizationRepository: OrganizationRepository;
    seatEventFns?: any;
  }): EESubscriptionService {
    const organizationRepository = toBillingOrganizationRepository(
      options.organizationRepository,
    );
    const service = BillingSubscriptionService.create({
      repository: toBillingRepository(options.repository),
      organizationRepository,
      teamRepository: {
        tryFindFirstTeamId: async (organizationId) => {
          const team = await options.prisma.team.findFirst({
            where: { organizationId },
            orderBy: { createdAt: "asc" },
            select: { id: true },
          });
          return team?.id ?? null;
        },
      },
      stripe: options.stripe,
      itemCalculator: options.itemCalculator as any,
      seatEventFns: options.seatEventFns,
      notifier: createNotifier(),
    });
    return new EESubscriptionService(service, options.repository);
  }

  static create({
    stripe,
    db,
    itemCalculator,
    seatEventFns,
  }: {
    stripe: Stripe;
    db: PrismaClient;
    itemCalculator: ItemCalculator;
    seatEventFns?: any;
  }): SubscriptionService {
    const persistence = PostgresBillingAdapter.create(db).build();
    const repository = persistence.subscriptions as unknown as SubscriptionRepository;
    return traced(
      EESubscriptionService.createWithDependencies({
        prisma: db,
        repository,
        stripe,
        itemCalculator,
        organizationRepository: persistence.organization,
        seatEventFns,
      }),
      "EESubscriptionService",
    );
  }

  updateSubscriptionItems(
    params: Parameters<SubscriptionService["updateSubscriptionItems"]>[0],
  ) {
    return this.service.updateSubscriptionItems(params as any);
  }

  createOrUpdateSubscription(
    params: Parameters<SubscriptionService["createOrUpdateSubscription"]>[0],
  ) {
    return this.service.createOrUpdateSubscription(params as any);
  }

  createBillingPortalSession(
    params: Parameters<SubscriptionService["createBillingPortalSession"]>[0],
  ) {
    return this.service.createBillingPortalSession(params);
  }

  async getLastNonCancelledSubscription(
    organizationId: string,
  ): Promise<Subscription | null> {
    return this.legacyRepository.findLastNonCancelled(organizationId);
  }

  previewProration(params: Parameters<SubscriptionService["previewProration"]>[0]) {
    return this.service.previewProration(params);
  }

  notifyProspective(params: Parameters<SubscriptionService["notifyProspective"]>[0]) {
    return this.service.notifyProspective(params as any);
  }

  createSubscriptionWithInvites(
    params: Parameters<SubscriptionService["createSubscriptionWithInvites"]>[0],
  ) {
    return this.service.createSubscriptionWithInvites(params as any);
  }

  listInvoices(
    params: Parameters<SubscriptionService["listInvoices"]>[0],
  ): Promise<DisplayInvoice[]> {
    return this.service.listInvoices(params) as Promise<DisplayInvoice[]>;
  }
}
