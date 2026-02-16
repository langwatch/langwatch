import Stripe from "stripe";
import { PLAN_LIMITS } from "./planLimits";
import { PlanTypes, type PlanTypes as PlanType } from "./planTypes";
import { prices } from "./stripePriceCatalog";

export { prices };

type UpdateItem = {
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
  basePriceKey: keyof typeof prices;
  userPriceKey: keyof typeof prices;
  tracesPriceKey: keyof typeof prices;
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
  Object.prototype.hasOwnProperty.call(STRIPE_PLAN_CONFIG, plan);

const getPlanConfig = (plan: PlanType) =>
  hasConfigForPlan(plan) ? STRIPE_PLAN_CONFIG[plan] : undefined;

const getBasePrice = (plan: PlanType) =>
  prices[plan as keyof typeof prices];

export const getItemsToUpdate = (
  currentItems: Stripe.SubscriptionItem[],
  plan: PlanType,
  tracesToAdd: number,
  membersToAdd: number,
): UpdateItem[] => {
  const planConfig = getPlanConfig(plan);
  const itemsToUpdate: UpdateItem[] = [];

  let tracesItem: Stripe.SubscriptionItem | undefined;
  let userItem: Stripe.SubscriptionItem | undefined;
  let planItem: Stripe.SubscriptionItem | undefined;
  let deleteItems: Stripe.SubscriptionItem[] = [];

  if (planConfig) {
    const keepPriceIds = new Set([
      prices[planConfig.basePriceKey],
      prices[planConfig.userPriceKey],
      prices[planConfig.tracesPriceKey],
    ]);

    const keepItems = currentItems.filter((item) => {
      return keepPriceIds.has(item.plan.id);
    });

    deleteItems = currentItems.filter((item) => {
      return !keepItems.includes(item);
    });

    tracesItem = keepItems.find(
      (item) => item.plan.id === prices[planConfig.tracesPriceKey],
    );
    userItem = keepItems.find(
      (item) => item.plan.id === prices[planConfig.userPriceKey],
    );
    planItem = keepItems.find(
      (item) => item.plan.id === prices[planConfig.basePriceKey],
    );
  }

  const totalTraces = Math.max(0, tracesToAdd - PLAN_LIMITS[plan].maxMessagesPerMonth);
  const totalMembers = Math.max(0, membersToAdd - PLAN_LIMITS[plan].maxMembers);

  if (tracesItem && planConfig) {
    itemsToUpdate.push({
      id: tracesItem.id,
      quantity: Math.floor(totalTraces / planConfig.tracesUnit),
    });
  } else if (totalTraces > 0 && planConfig) {
    const tracesQuantity = Math.floor(totalTraces / planConfig.tracesUnit);
    if (tracesQuantity > 0) {
      itemsToUpdate.push({
        price: prices[planConfig.tracesPriceKey],
        quantity: tracesQuantity,
      });
    }
  }

  if (userItem && totalMembers > 0) {
    itemsToUpdate.push({
      id: userItem.id,
      quantity: totalMembers,
    });
  } else if (totalMembers > 0 && planConfig) {
    itemsToUpdate.push({
      price: prices[planConfig.userPriceKey],
      quantity: totalMembers,
    });
  }

  if (planItem) {
    itemsToUpdate.push({
      id: planItem.id,
      quantity: 1,
    });
  } else {
    itemsToUpdate.push({
      price: getBasePrice(plan),
      quantity: 1,
    });
  }

  if (deleteItems.length > 0) {
    for (const item of deleteItems) {
      itemsToUpdate.push({
        id: item.id,
        deleted: true,
      });
    }
  }

  for (const item of itemsToUpdate) {
    if (item.quantity === 0) {
      item.deleted = true;
    }
  }

  return itemsToUpdate;
};

export const calculateQuantityForPrice = (
  priceId: string,
  quantity: number,
  plan: string | undefined,
) => {
  const planLimits = plan ? PLAN_LIMITS[plan as PlanType] : undefined;
  const config = Object.values(STRIPE_PLAN_CONFIG).find((planConfig) => {
    return (
      priceId === prices[planConfig.userPriceKey] ||
      priceId === prices[planConfig.tracesPriceKey]
    );
  });

  if (!config) {
    return 0;
  }

  if (priceId === prices[config.userPriceKey]) {
    return (quantity ?? 0) + (planLimits?.maxMembers ?? 0);
  }

  return (quantity ?? 0) * config.tracesUnit + (planLimits?.maxMessagesPerMonth ?? 0);
};

export const createItemsToAdd = (
  planType: PlanType,
  traces: { quantity: number },
  users: { quantity: number },
): UpdateItem[] => {
  const planConfig = getPlanConfig(planType);
  const itemsToAdd: UpdateItem[] = [];

  const totalTraces = Math.max(
    0,
    traces.quantity - PLAN_LIMITS[planType].maxMessagesPerMonth,
  );
  const totalMembers = Math.max(0, users.quantity - PLAN_LIMITS[planType].maxMembers);

  if (!planConfig) {
    return itemsToAdd;
  }

  if (totalMembers > 0) {
    itemsToAdd.push({
      price: prices[planConfig.userPriceKey],
      quantity: totalMembers,
    });
  }

  if (totalTraces > 0) {
    const tracesQuantity = Math.floor(totalTraces / planConfig.tracesUnit);
    if (tracesQuantity > 0) {
      itemsToAdd.push({
        price: prices[planConfig.tracesPriceKey],
        quantity: tracesQuantity,
      });
    }
  }

  return itemsToAdd;
};
