import type { Subscription } from "@prisma/client";

export interface SubscriptionRepository {
  findLastNonCancelled(organizationId: string): Promise<Subscription | null>;

  createPending(input: {
    organizationId: string;
    plan: string;
  }): Promise<Subscription>;

  updateStatus(input: {
    id: string;
    status: string;
  }): Promise<Subscription>;

  updatePlan(input: {
    id: string;
    plan: string;
  }): Promise<Subscription>;
}

export class NullSubscriptionRepository implements SubscriptionRepository {
  async findLastNonCancelled(
    _organizationId: string,
  ): Promise<Subscription | null> {
    return null;
  }

  async createPending(_input: {
    organizationId: string;
    plan: string;
  }): Promise<Subscription> {
    return {} as Subscription;
  }

  async updateStatus(_input: {
    id: string;
    status: string;
  }): Promise<Subscription> {
    return {} as Subscription;
  }

  async updatePlan(_input: {
    id: string;
    plan: string;
  }): Promise<Subscription> {
    return {} as Subscription;
  }
}
