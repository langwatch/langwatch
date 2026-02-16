import stripeCatalogData from "./stripeCatalog.json";
import {
  STRIPE_PRICE_NAMES,
  type StripeEnvironment,
  type StripePriceDetail,
  type StripePriceMap,
  type StripePriceName,
  type StripePricesFile,
} from "./stripePrices.types";

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const assertString = (value: unknown, path: string): string => {
  if (typeof value !== "string") {
    throw new Error(`${path} must be a string`);
  }

  return value;
};

const assertBoolean = (value: unknown, path: string): boolean => {
  if (typeof value !== "boolean") {
    throw new Error(`${path} must be a boolean`);
  }

  return value;
};

const assertNullableString = (value: unknown, path: string): string | null => {
  if (value === null) {
    return null;
  }

  return assertString(value, path);
};

const parseStripePriceDetail = (
  value: unknown,
  path: string,
): StripePriceDetail => {
  if (!isRecord(value)) {
    throw new Error(`${path} must be an object`);
  }

  const type = assertString(value.type, `${path}.type`);
  if (type !== "one_time" && type !== "recurring") {
    throw new Error(`${path}.type must be one_time or recurring`);
  }

  let recurring: StripePriceDetail["recurring"] = null;
  if (value.recurring !== null) {
    if (!isRecord(value.recurring)) {
      throw new Error(`${path}.recurring must be an object or null`);
    }

    const interval = assertString(value.recurring.interval, `${path}.recurring.interval`);
    if (
      interval !== "day" &&
      interval !== "week" &&
      interval !== "month" &&
      interval !== "year"
    ) {
      throw new Error(`${path}.recurring.interval must be day/week/month/year`);
    }

    const intervalCount = value.recurring.intervalCount;
    if (typeof intervalCount !== "number") {
      throw new Error(`${path}.recurring.intervalCount must be a number`);
    }

    recurring = {
      interval,
      intervalCount,
    };
  }

  if (!isRecord(value.metadata)) {
    throw new Error(`${path}.metadata must be an object`);
  }

  const metadata: Record<string, string> = {};
  for (const [metadataKey, metadataValue] of Object.entries(value.metadata)) {
    metadata[metadataKey] = assertString(
      metadataValue,
      `${path}.metadata.${metadataKey}`,
    );
  }

  const unitAmount = value.unitAmount;
  if (unitAmount !== null && typeof unitAmount !== "number") {
    throw new Error(`${path}.unitAmount must be a number or null`);
  }

  return {
    id: assertString(value.id, `${path}.id`),
    active: assertBoolean(value.active, `${path}.active`),
    livemode: assertBoolean(value.livemode, `${path}.livemode`),
    product: assertNullableString(value.product, `${path}.product`),
    unitAmount,
    currency: assertString(value.currency, `${path}.currency`),
    type,
    recurring,
    nickname: assertNullableString(value.nickname, `${path}.nickname`),
    lookupKey: assertNullableString(value.lookupKey, `${path}.lookupKey`),
    metadata,
  };
};

export const parseStripePricesFile = (value: unknown): StripePricesFile => {
  if (!isRecord(value)) {
    throw new Error("stripeCatalog.json must contain an object");
  }

  const schemaVersion = value.schemaVersion;
  if (typeof schemaVersion !== "number") {
    throw new Error("schemaVersion must be a number");
  }

  const updatedAt = assertString(value.updatedAt, "updatedAt");

  if (!isRecord(value.mapping)) {
    throw new Error("mapping must be an object");
  }

  const mapping = {} as StripePricesFile["mapping"];
  for (const key of STRIPE_PRICE_NAMES) {
    const entry = value.mapping[key];
    if (!isRecord(entry)) {
      throw new Error(`mapping.${key} must be an object`);
    }

    mapping[key] = {
      test: assertString(entry.test, `mapping.${key}.test`),
      live: assertString(entry.live, `mapping.${key}.live`),
    };
  }

  if (!isRecord(value.prices)) {
    throw new Error("prices must be an object");
  }

  const prices: Record<string, StripePriceDetail> = {};
  for (const [priceId, price] of Object.entries(value.prices)) {
    prices[priceId] = parseStripePriceDetail(price, `prices.${priceId}`);
  }

  return {
    schemaVersion,
    updatedAt,
    mapping,
    prices,
  };
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
