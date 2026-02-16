export const STRIPE_PRICE_NAMES = [
  "PRO",
  "GROWTH",
  "LAUNCH",
  "LAUNCH_ANNUAL",
  "ACCELERATE",
  "ACCELERATE_ANNUAL",
  "LAUNCH_USERS",
  "ACCELERATE_USERS",
  "LAUNCH_TRACES_10K",
  "ACCELERATE_TRACES_100K",
  "LAUNCH_ANNUAL_TRACES_10K",
  "ACCELERATE_ANNUAL_TRACES_100K",
  "LAUNCH_ANNUAL_USERS",
  "ACCELERATE_ANNUAL_USERS",
] as const;

export type StripePriceName = (typeof STRIPE_PRICE_NAMES)[number];

export type StripeEnvironment = "test" | "live";

export type StripePriceDetail = {
  id: string;
  active: boolean;
  livemode: boolean;
  product: string | null;
  unitAmount: number | null;
  currency: string;
  type: "one_time" | "recurring";
  recurring: {
    interval: "day" | "week" | "month" | "year";
    intervalCount: number;
  } | null;
  nickname: string | null;
  lookupKey: string | null;
  metadata: Record<string, string>;
};

export type StripePriceMapping = Record<
  StripePriceName,
  Record<StripeEnvironment, string>
>;

export type StripePricesFile = {
  schemaVersion: number;
  updatedAt: string;
  mapping: StripePriceMapping;
  prices: Record<string, StripePriceDetail>;
};

export type StripePriceMap = Record<StripePriceName, string>;
