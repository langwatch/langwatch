import {
  isStripePriceName,
  PLAN_LIMITS,
  type PlanTypes as PlanType,
  PlanTypes,
  type StripePriceMap,
  type StripePriceName,
} from "@langwatch/enterprise-billing-contract";
import type Stripe from "stripe";

export type SubscriptionItemUpdate = {
  id?: string;
  price?: string;
  quantity?: number;
  deleted?: boolean;
};

type AddOnPlan =
  | typeof PlanTypes.LAUNCH
  | typeof PlanTypes.LAUNCH_ANNUAL
  | typeof PlanTypes.ACCELERATE
  | typeof PlanTypes.ACCELERATE_ANNUAL;

type StripePlanPriceConfig = {
  basePriceKey: StripePriceName;
  userPriceKey: StripePriceName;
  tracesPriceKey: StripePriceName;
  tracesUnit: 10_000 | 100_000;
};

const STRIPE_PLAN_CONFIG: Record<AddOnPlan, StripePlanPriceConfig> = {
  [PlanTypes.LAUNCH]: {
    basePriceKey: "LAUNCH",
    userPriceKey: "LAUNCH_USERS",
    tracesPriceKey: "LAUNCH_TRACES_10K",
    tracesUnit: 10_000,
  },
  [PlanTypes.LAUNCH_ANNUAL]: {
    basePriceKey: "LAUNCH_ANNUAL",
    userPriceKey: "LAUNCH_ANNUAL_USERS",
    tracesPriceKey: "LAUNCH_ANNUAL_TRACES_10K",
    tracesUnit: 10_000,
  },
  [PlanTypes.ACCELERATE]: {
    basePriceKey: "ACCELERATE",
    userPriceKey: "ACCELERATE_USERS",
    tracesPriceKey: "ACCELERATE_TRACES_100K",
    tracesUnit: 100_000,
  },
  [PlanTypes.ACCELERATE_ANNUAL]: {
    basePriceKey: "ACCELERATE_ANNUAL",
    userPriceKey: "ACCELERATE_ANNUAL_USERS",
    tracesPriceKey: "ACCELERATE_ANNUAL_TRACES_100K",
    tracesUnit: 100_000,
  },
};

const hasConfigForPlan = (plan: PlanType): plan is AddOnPlan =>
  Object.hasOwn(STRIPE_PLAN_CONFIG, plan);

export class SubscriptionItemCalculatorService {
  private constructor(readonly prices: StripePriceMap) {}

  static create(prices: StripePriceMap): SubscriptionItemCalculatorService {
    return new SubscriptionItemCalculatorService(prices);
  }

  getItemsToUpdate(input: {
    currentItems: Stripe.SubscriptionItem[];
    plan: PlanType;
    tracesToAdd: number;
    membersToAdd: number;
  }): SubscriptionItemUpdate[] {
    const planConfig = this.tryGetPlanConfig(input.plan);
    const updates: SubscriptionItemUpdate[] = [];
    let tracesItem: Stripe.SubscriptionItem | undefined;
    let userItem: Stripe.SubscriptionItem | undefined;
    let planItem: Stripe.SubscriptionItem | undefined;
    let deleteItems: Stripe.SubscriptionItem[] = [];

    if (planConfig) {
      const keepPriceIds = new Set([
        this.prices[planConfig.basePriceKey],
        this.prices[planConfig.userPriceKey],
        this.prices[planConfig.tracesPriceKey],
      ]);
      const keepItems = input.currentItems.filter((item) =>
        keepPriceIds.has(item.price.id),
      );
      deleteItems = input.currentItems.filter((item) => !keepItems.includes(item));
      tracesItem = keepItems.find(
        (item) => item.price.id === this.prices[planConfig.tracesPriceKey],
      );
      userItem = keepItems.find(
        (item) => item.price.id === this.prices[planConfig.userPriceKey],
      );
      planItem = keepItems.find(
        (item) => item.price.id === this.prices[planConfig.basePriceKey],
      );
    }

    const limits = PLAN_LIMITS[input.plan];
    if (!limits) return [];
    const totalTraces = Math.max(0, input.tracesToAdd - limits.maxMessagesPerMonth);
    const totalMembers = Math.max(0, input.membersToAdd - limits.maxMembers);

    if (tracesItem && planConfig) {
      updates.push({
        id: tracesItem.id,
        quantity: Math.floor(totalTraces / planConfig.tracesUnit),
      });
    } else if (totalTraces > 0 && planConfig) {
      const quantity = Math.floor(totalTraces / planConfig.tracesUnit);
      if (quantity > 0)
        updates.push({ price: this.prices[planConfig.tracesPriceKey], quantity });
    }
    if (userItem) updates.push({ id: userItem.id, quantity: totalMembers });
    else if (totalMembers > 0 && planConfig)
      updates.push({
        price: this.prices[planConfig.userPriceKey],
        quantity: totalMembers,
      });
    if (planItem) updates.push({ id: planItem.id, quantity: 1 });
    else {
      const basePrice = this.tryGetBasePrice(input.plan);
      if (basePrice) updates.push({ price: basePrice, quantity: 1 });
    }
    for (const item of deleteItems) updates.push({ id: item.id, deleted: true });
    for (const item of updates) if (item.quantity === 0) item.deleted = true;
    return updates;
  }

  calculateQuantityForPrice(input: {
    priceId: string;
    quantity: number;
    plan: string | undefined;
  }): number {
    const limits = input.plan ? PLAN_LIMITS[input.plan as PlanType] : undefined;
    const config = Object.values(STRIPE_PLAN_CONFIG).find(
      (candidate) =>
        input.priceId === this.prices[candidate.userPriceKey] ||
        input.priceId === this.prices[candidate.tracesPriceKey],
    );
    if (!config) return 0;
    if (input.priceId === this.prices[config.userPriceKey])
      return input.quantity + (limits?.maxMembers ?? 0);
    return input.quantity * config.tracesUnit + (limits?.maxMessagesPerMonth ?? 0);
  }

  createItemsToAdd(
    plan: PlanType,
    traces: { quantity: number },
    users: { quantity: number },
  ): SubscriptionItemUpdate[] {
    const config = this.tryGetPlanConfig(plan);
    const limits = PLAN_LIMITS[plan];
    if (!config || !limits) return [];
    const updates: SubscriptionItemUpdate[] = [];
    const totalMembers = Math.max(0, users.quantity - limits.maxMembers);
    const totalTraces = Math.max(0, traces.quantity - limits.maxMessagesPerMonth);
    if (totalMembers > 0)
      updates.push({ price: this.prices[config.userPriceKey], quantity: totalMembers });
    const tracesQuantity = Math.floor(totalTraces / config.tracesUnit);
    if (tracesQuantity > 0)
      updates.push({
        price: this.prices[config.tracesPriceKey],
        quantity: tracesQuantity,
      });
    return updates;
  }

  private tryGetPlanConfig(plan: PlanType): StripePlanPriceConfig | undefined {
    return hasConfigForPlan(plan) ? STRIPE_PLAN_CONFIG[plan] : undefined;
  }

  private tryGetBasePrice(plan: PlanType): string | undefined {
    const config = this.tryGetPlanConfig(plan);
    if (config) return this.prices[config.basePriceKey];
    return isStripePriceName(plan) ? this.prices[plan] : undefined;
  }
}
