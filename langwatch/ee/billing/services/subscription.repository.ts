import {
  type PrismaClient,
  type Subscription,
  SubscriptionStatus as PrismaSubscriptionStatus,
  PlanTypes as PrismaPlanTypes,
} from "@prisma/client";
import type { SubscriptionRepository } from "../../../src/server/app-layer/subscription/subscription.repository";
import { SubscriptionStatus } from "../planTypes";

/**
 * Prisma-backed implementation of SubscriptionRepository.
 * Handles only subscription-table CRUD -- no organization or team queries.
 */
export class PrismaSubscriptionRepository implements SubscriptionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findLastNonCancelled(
    organizationId: string,
  ): Promise<Subscription | null> {
    return await this.prisma.subscription.findFirst({
      where: {
        organizationId,
        status: {
          not: SubscriptionStatus.CANCELLED as PrismaSubscriptionStatus,
        },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async createPending(input: {
    organizationId: string;
    plan: string;
  }): Promise<Subscription> {
    return await this.prisma.subscription.create({
      data: {
        organizationId: input.organizationId,
        status: SubscriptionStatus.PENDING as PrismaSubscriptionStatus,
        plan: input.plan as PrismaPlanTypes,
      },
    });
  }

  async updateStatus(input: {
    id: string;
    status: string;
  }): Promise<Subscription> {
    return await this.prisma.subscription.update({
      where: { id: input.id },
      data: { status: input.status as PrismaSubscriptionStatus },
    });
  }

  async updatePlan(input: {
    id: string;
    plan: string;
  }): Promise<Subscription> {
    return await this.prisma.subscription.update({
      where: { id: input.id },
      data: { plan: input.plan as PrismaPlanTypes },
    });
  }
}
