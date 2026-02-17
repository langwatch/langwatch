import stripeCatalogData from "./stripeCatalog.json";
import {
  STRIPE_PRICE_NAMES,
  type StripeEnvironment,
  type StripePriceMap,
  type StripePriceName,
  type StripePricesFile,
  stripePricesFileSchema,
} from "./stripePrices.types";

export const parseStripePricesFile = (value: unknown): StripePricesFile => {
  return stripePricesFileSchema.parse(value);
};

export const getStripeEnvironmentFromNodeEnv = (
  nodeEnv = process.env.NODE_ENV,
): StripeEnvironment => {
  return nodeEnv === "production" ? "live" : "test";
};

export const resolveStripePriceMap = (
  data: StripePricesFile,
  environment: StripeEnvironment,
): StripePriceMap => {
  const resolvedPrices = {} as StripePriceMap;

  for (const key of STRIPE_PRICE_NAMES) {
    const priceId = data.mapping[key][environment];
    if (!priceId) {
      throw new Error(`Missing mapped price for ${key} in ${environment} mode`);
    }

    resolvedPrices[key] = priceId;
  }

  return resolvedPrices;
};

export const stripePricesFile = parseStripePricesFile(stripeCatalogData);

export const prices = resolveStripePriceMap(
  stripePricesFile,
  getStripeEnvironmentFromNodeEnv(),
);

export const isStripePriceName = (value: string): value is StripePriceName => {
  return STRIPE_PRICE_NAMES.includes(value as StripePriceName);
};
