import Stripe from "stripe";
import { PLAN_LIMITS } from "./planLimits";
import { PlanTypes, type PlanTypes as PlanType } from "./planTypes";

export const prices: Record<
  | "PRO"
  | "GROWTH"
  | "LAUNCH"
  | "LAUNCH_ANNUAL"
  | "ACCELERATE"
  | "ACCELERATE_ANNUAL"
  | "LAUNCH_USERS"
  | "ACCELERATE_USERS"
  | "LAUNCH_TRACES_10K"
  | "ACCELERATE_TRACES_100K"
  | "LAUNCH_ANNUAL_TRACES_10K"
  | "ACCELERATE_ANNUAL_TRACES_100K"
  | "LAUNCH_ANNUAL_USERS"
  | "ACCELERATE_ANNUAL_USERS",
  string
> =
  process.env.NODE_ENV === "production"
    ? {
        PRO: "price_1P6fvzIMsTw08cudWCwqfEjq",
        GROWTH: "price_1P6fw2IMsTw08cudFUkOX7jV",
        LAUNCH: "price_1QRflaIMsTw08cudIMK1ai2x",
        LAUNCH_ANNUAL: "price_1QRfmKIMsTw08cud2FNGkopZ",
        ACCELERATE: "price_1R9QlPIMsTw08cudEupEEivx",
        ACCELERATE_ANNUAL: "price_1R9QmNIMsTw08cudpk6UDhZg",
        LAUNCH_USERS: "price_1QHNZ1IMsTw08cudbfSO8xOt",
        ACCELERATE_USERS: "price_1QeC8uIMsTw08cudqxcFMrCd",
        LAUNCH_TRACES_10K: "price_1R55Y9IMsTw08cudoJBCK9Zq",
        ACCELERATE_TRACES_100K: "price_1R9R7CIMsTw08cudFKXaCUjK",
        LAUNCH_ANNUAL_TRACES_10K: "price_1R9R1FIMsTw08cudjyrUQ2de",
        ACCELERATE_ANNUAL_TRACES_100K: "price_1R9RAGIMsTw08cudG1qutTQi",
        LAUNCH_ANNUAL_USERS: "price_1R9QseIMsTw08cudNuAgREET",
        ACCELERATE_ANNUAL_USERS: "price_1R9QtYIMsTw08cud2pHVq7XK",
      }
    : {
        PRO: "price_1P6bSyIMsTw08cudmzoqwBVN",
        GROWTH: "price_1P6fbyIMsTw08cudKh5L8w8x",
        LAUNCH: "price_1R9LHnIMsTw08cudoc9eO4L8",
        LAUNCH_ANNUAL: "price_1R9LIcIMsTw08cudk2QB7qfD",
        ACCELERATE: "price_1R9LMvIMsTw08cudDvep2CIz",
        ACCELERATE_ANNUAL: "price_1R9LNbIMsTw08cudIBv5n38r",
        LAUNCH_USERS: "price_1QRby4IMsTw08cud0IDctQuX",
        ACCELERATE_USERS: "price_1R6nx1IMsTw08cudjSeT6Qoj",
        LAUNCH_TRACES_10K: "price_1R6YYpIMsTw08cudI2IEMIkk",
        ACCELERATE_TRACES_100K: "price_1R6nttIMsTw08cudaPXCFRPc",
        LAUNCH_ANNUAL_TRACES_10K: "price_1R9LLeIMsTw08cudK3be8XZ7",
        ACCELERATE_ANNUAL_TRACES_100K: "price_1R9LAVIMsTw08cudVWx5aKLY",
        LAUNCH_ANNUAL_USERS: "price_1R9LJfIMsTw08cudLqdRyQX8",
        ACCELERATE_ANNUAL_USERS: "price_1R9LKfIMsTw08cudopZOEoto",
      };

type UpdateItem = {
  id?: string;
  price?: string;
  quantity?: number;
  deleted?: boolean;
};

function getPriceKey(
  plan: PlanType,
  suffix: string,
): keyof typeof prices | undefined {
  const key = `${plan}_${suffix}` as keyof typeof prices;
  return key in prices ? key : undefined;
}

export const getItemsToUpdate = (
  currentItems: Stripe.SubscriptionItem[],
  plan: PlanType,
  tracesToAdd: number,
  membersToAdd: number,
): UpdateItem[] => {
  const itemsToUpdate: UpdateItem[] = [];

  let tracesLaunch10KItem: Stripe.SubscriptionItem | undefined;
  let tracesAccelerate100KItem: Stripe.SubscriptionItem | undefined;
  let userItemLaunch: Stripe.SubscriptionItem | undefined;
  let userItemAccelerate: Stripe.SubscriptionItem | undefined;
  let userItemLaunchAnnual: Stripe.SubscriptionItem | undefined;
  let userItemAccelerateAnnual: Stripe.SubscriptionItem | undefined;
  let tracesLaunch10KItemAnnual: Stripe.SubscriptionItem | undefined;
  let tracesAccelerate100KItemAnnual: Stripe.SubscriptionItem | undefined;
  let planItem: Stripe.SubscriptionItem | undefined;
  let deleteItems: Stripe.SubscriptionItem[] = [];

  if (plan === PlanTypes.LAUNCH) {
    const keepItems = currentItems.filter((item) => {
      return (
        item.plan.id === prices.LAUNCH_TRACES_10K ||
        item.plan.id === prices.LAUNCH_USERS ||
        item.plan.id === prices[plan]
      );
    });

    deleteItems = currentItems.filter((item) => {
      return !keepItems.includes(item);
    });

    tracesLaunch10KItem = keepItems.find(
      (item) => item.plan.id === prices.LAUNCH_TRACES_10K,
    );
    userItemLaunch = keepItems.find((item) => item.plan.id === prices.LAUNCH_USERS);
    planItem = keepItems.find((item) => item.plan.id === prices[plan]);
  }

  if (plan === PlanTypes.LAUNCH_ANNUAL) {
    const keepItems = currentItems.filter((item) => {
      return (
        item.plan.id === prices.LAUNCH_ANNUAL_TRACES_10K ||
        item.plan.id === prices.LAUNCH_ANNUAL_USERS ||
        item.plan.id === prices[plan]
      );
    });

    deleteItems = currentItems.filter((item) => {
      return !keepItems.includes(item);
    });

    tracesLaunch10KItemAnnual = keepItems.find(
      (item) => item.plan.id === prices.LAUNCH_ANNUAL_TRACES_10K,
    );
    userItemLaunchAnnual = keepItems.find(
      (item) => item.plan.id === prices.LAUNCH_ANNUAL_USERS,
    );
    planItem = keepItems.find((item) => item.plan.id === prices[plan]);
  }

  if (plan === PlanTypes.ACCELERATE) {
    const keepItems = currentItems.filter((item) => {
      return (
        item.plan.id === prices.ACCELERATE_TRACES_100K ||
        item.plan.id === prices.ACCELERATE_USERS ||
        item.plan.id === prices[plan]
      );
    });

    deleteItems = currentItems.filter((item) => {
      return !keepItems.includes(item);
    });

    tracesAccelerate100KItem = keepItems.find(
      (item) => item.plan.id === prices.ACCELERATE_TRACES_100K,
    );
    userItemAccelerate = keepItems.find(
      (item) => item.plan.id === prices.ACCELERATE_USERS,
    );

    planItem = keepItems.find((item) => item.plan.id === prices[plan]);
  }

  if (plan === PlanTypes.ACCELERATE_ANNUAL) {
    const keepItems = currentItems.filter((item) => {
      return (
        item.plan.id === prices.ACCELERATE_ANNUAL_TRACES_100K ||
        item.plan.id === prices.ACCELERATE_ANNUAL_USERS ||
        item.plan.id === prices[plan]
      );
    });

    deleteItems = currentItems.filter((item) => {
      return !keepItems.includes(item);
    });

    tracesAccelerate100KItemAnnual = keepItems.find(
      (item) => item.plan.id === prices.ACCELERATE_ANNUAL_TRACES_100K,
    );
    userItemAccelerateAnnual = keepItems.find(
      (item) => item.plan.id === prices.ACCELERATE_ANNUAL_USERS,
    );

    planItem = keepItems.find((item) => item.plan.id === prices[plan]);
  }

  const totalTraces = Math.max(0, tracesToAdd - PLAN_LIMITS[plan].maxMessagesPerMonth);
  const totalMembers = Math.max(0, membersToAdd - PLAN_LIMITS[plan].maxMembers);

  const { quantity100K, quantity10K } = getQuantity(totalTraces);

  if (tracesAccelerate100KItem || tracesAccelerate100KItemAnnual) {
    itemsToUpdate.push({
      id: tracesAccelerate100KItem?.id || tracesAccelerate100KItemAnnual?.id,
      quantity: quantity100K,
    });
  } else if (quantity100K > 0) {
    if (plan === PlanTypes.ACCELERATE || plan === PlanTypes.ACCELERATE_ANNUAL) {
      const tracesPriceKey = getPriceKey(plan, "TRACES_100K");
      if (tracesPriceKey) {
        itemsToUpdate.push({
          price: prices[tracesPriceKey],
          quantity: quantity100K,
        });
      }
    }
  }

  if (tracesLaunch10KItem || tracesLaunch10KItemAnnual) {
    itemsToUpdate.push({
      id: tracesLaunch10KItem?.id || tracesLaunch10KItemAnnual?.id,
      quantity: quantity10K,
    });
  } else if (quantity10K > 0) {
    if (plan === PlanTypes.LAUNCH || plan === PlanTypes.LAUNCH_ANNUAL) {
      const tracesPriceKey = getPriceKey(plan, "TRACES_10K");
      if (tracesPriceKey) {
        itemsToUpdate.push({
          price: prices[tracesPriceKey],
          quantity: quantity10K,
        });
      }
    }
  }

  if (
    (userItemLaunch ||
      userItemAccelerate ||
      userItemLaunchAnnual ||
      userItemAccelerateAnnual) &&
    totalMembers > 0
  ) {
    itemsToUpdate.push({
      id:
        userItemLaunch?.id ||
        userItemAccelerate?.id ||
        userItemLaunchAnnual?.id ||
        userItemAccelerateAnnual?.id,
      quantity: totalMembers,
    });
  } else if (totalMembers > 0) {
    const userPriceKey = getPriceKey(plan, "USERS");
    if (userPriceKey) {
      itemsToUpdate.push({
        price: prices[userPriceKey],
        quantity: totalMembers,
      });
    }
  }

  if (planItem) {
    itemsToUpdate.push({
      id: planItem.id,
      quantity: 1,
    });
  } else {
    itemsToUpdate.push({
      price: prices[plan as keyof typeof prices],
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

  switch (priceId) {
    case prices.LAUNCH_USERS:
    case prices.ACCELERATE_USERS:
    case prices.LAUNCH_ANNUAL_USERS:
    case prices.ACCELERATE_ANNUAL_USERS:
      return (quantity ?? 0) + (planLimits?.maxMembers ?? 0);
    case prices.LAUNCH_TRACES_10K:
    case prices.LAUNCH_ANNUAL_TRACES_10K:
      return (quantity ?? 0) * 10_000 + (planLimits?.maxMessagesPerMonth ?? 0);
    case prices.ACCELERATE_TRACES_100K:
    case prices.ACCELERATE_ANNUAL_TRACES_100K:
      return (quantity ?? 0) * 100_000 + (planLimits?.maxMessagesPerMonth ?? 0);
    default:
      return 0;
  }
};

export const createItemsToAdd = (
  planType: PlanType,
  traces: { quantity: number },
  users: { quantity: number },
): UpdateItem[] => {
  let itemsToAdd: UpdateItem[] = [];

  const totalTraces = Math.max(
    0,
    traces.quantity - PLAN_LIMITS[planType].maxMessagesPerMonth,
  );
  const totalMembers = Math.max(0, users.quantity - PLAN_LIMITS[planType].maxMembers);

  const { quantity100K, quantity10K } = getQuantity(totalTraces);

  if (totalMembers > 0) {
    const userPriceKey = getPriceKey(planType, "USERS");
    if (userPriceKey) {
      itemsToAdd.push({
        price: prices[userPriceKey],
        quantity: totalMembers,
      });
    }
  }

  if (quantity100K > 0) {
    if (planType === PlanTypes.ACCELERATE || planType === PlanTypes.ACCELERATE_ANNUAL) {
      const tracesPriceKey = getPriceKey(planType, "TRACES_100K");
      if (tracesPriceKey) {
        itemsToAdd.push({
          price: prices[tracesPriceKey],
          quantity: quantity100K,
        });
      }
    }
  }

  if (quantity10K > 0) {
    if (planType === PlanTypes.LAUNCH || planType === PlanTypes.LAUNCH_ANNUAL) {
      const tracesPriceKey = getPriceKey(planType, "TRACES_10K");
      if (tracesPriceKey) {
        itemsToAdd.push({
          price: prices[tracesPriceKey],
          quantity: quantity10K,
        });
      }
    }
  }

  itemsToAdd = itemsToAdd.filter((item) => item.quantity !== 0);

  return itemsToAdd;
};

const getQuantity = (totalTraces: number) => {
  const quantity100K = Math.floor(totalTraces / 100_000);
  const quantity10K = Math.floor(totalTraces / 10_000);

  return { quantity100K, quantity10K };
};
