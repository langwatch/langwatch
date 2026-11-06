import stripeCatalogData from "./stripe-catalog.json" with { type: "json" };
import {
  OPTIONAL_STRIPE_METER_NAMES,
  OPTIONAL_STRIPE_PRICE_NAMES,
  STRIPE_METER_NAMES,
  STRIPE_PRICE_NAMES,
  type StripeEnvironment,
  type StripeMeterMap,
  type StripePriceMap,
  type StripePriceName,
  type StripePricesFile,
  stripePricesFileSchema,
} from "./stripe-prices.ts";

export const parseStripePricesFile = (value: unknown): StripePricesFile => {
  return stripePricesFileSchema.parse(value);
};

export const getStripeEnvironmentFromNodeEnv = (nodeEnv: string | undefined): StripeEnvironment => {
  return nodeEnv === "production" ? "live" : "test";
};

export const resolveStripePriceMap = (
  data: StripePricesFile,
  environment: StripeEnvironment,
): StripePriceMap => {
  const resolvedPrices = {} as StripePriceMap;

  for (const key of STRIPE_PRICE_NAMES) {
    const priceId = data.mapping[key]?.[environment];
    if (!priceId) {
      // An optional name is left unresolved rather than thrown on: it is
      // provisioned per mode by hand, and the surface that reads it checks
      // whether it resolved. Everything else is a plan nobody could buy.
      if (OPTIONAL_STRIPE_PRICE_NAMES.includes(key)) continue;
      throw new Error(`Missing mapped price for ${key} in ${environment} mode`);
    }

    resolvedPrices[key] = priceId;
  }

  return resolvedPrices;
};

export const stripePricesFile = parseStripePricesFile(stripeCatalogData);

export const resolveStripeMeterMap = (
  data: StripePricesFile,
  environment: StripeEnvironment,
): StripeMeterMap => {
  const resolved = {} as StripeMeterMap;
  for (const key of STRIPE_METER_NAMES) {
    const meterId = data.meters?.[key]?.[environment];
    if (!meterId) {
      if (OPTIONAL_STRIPE_METER_NAMES.includes(key)) continue;
      throw new Error(`Missing mapped meter for ${key} in ${environment} mode`);
    }
    resolved[key] = meterId;
  }
  return resolved;
};

export const isStripePriceName = (value: string): value is StripePriceName => {
  return STRIPE_PRICE_NAMES.includes(value as StripePriceName);
};

export class BillingPriceCatalogue {
  private constructor(
    readonly environment: StripeEnvironment,
    readonly prices: StripePriceMap,
    readonly meters: StripeMeterMap,
  ) {}

  static create(environment: StripeEnvironment): BillingPriceCatalogue {
    return new BillingPriceCatalogue(
      environment,
      resolveStripePriceMap(stripePricesFile, environment),
      resolveStripeMeterMap(stripePricesFile, environment),
    );
  }
}

/** The Stripe products the Growth checkout charges: its seats and its metered events. */
export type GrowthCheckoutProducts = Readonly<{ seats: string; events: string }>;

/**
 * The Growth Seats and Growth Events products of one Stripe mode, read off the catalogue's
 * own price records so a coupon is limited to what the checkout actually sells.
 */
export const resolveGrowthCheckoutProducts = (
  data: StripePricesFile,
  environment: StripeEnvironment,
): GrowthCheckoutProducts => {
  const productOf = (name: StripePriceName): string => {
    const priceId = data.mapping[name]?.[environment];
    const product = priceId ? data.prices[priceId]?.product : null;
    if (!product) throw new Error(`No product recorded for ${name} in ${environment} mode`);
    return product;
  };
  return {
    seats: productOf("GROWTH_SEAT_EUR_MONTHLY"),
    events: productOf("GROWTH_EVENTS_EUR_MONTHLY"),
  };
};
