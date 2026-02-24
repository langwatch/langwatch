import { Currency } from "@prisma/client";
import { prices, stripePricesFile } from "./stripe/stripePriceCatalog";
import type { StripePriceName } from "./stripe/stripePrices.types";

export type { Currency } from "@prisma/client";

function getUnitAmountCents(name: StripePriceName): number {
  const priceId = prices[name];
  const detail = stripePricesFile.prices[priceId];
  if (!detail?.unitAmount) throw new Error(`No unitAmount for ${name}`);
  return detail.unitAmount;
}

/** Seat prices from Stripe catalog in CENTS (integer-safe arithmetic) */
export function getGrowthSeatPriceCents(): Record<
  Currency,
  { monthly: number; annual: number }
> {
  return {
    [Currency.EUR]: {
      monthly: getUnitAmountCents("GROWTH_SEAT_EUR_MONTHLY"),
      annual: getUnitAmountCents("GROWTH_SEAT_EUR_ANNUAL"),
    },
    [Currency.USD]: {
      monthly: getUnitAmountCents("GROWTH_SEAT_USD_MONTHLY"),
      annual: getUnitAmountCents("GROWTH_SEAT_USD_ANNUAL"),
    },
  };
}

/** Annual discount % derived from catalog (e.g. 8) */
export function getAnnualDiscountPercent(currency: Currency): number {
  const p = getGrowthSeatPriceCents();
  return Math.round(
    (1 - p[currency].annual / (p[currency].monthly * 12)) * 100,
  );
}

/**
 * Format cents to display price with currency symbol.
 * Uses Intl.NumberFormat for proper thousands separators and decimal handling.
 */
export function formatPrice({
  cents,
  currency,
}: {
  cents: number;
  currency: Currency;
}): string {
  const amount = cents / 100;
  return new Intl.NumberFormat(currency === Currency.EUR ? "en-IE" : "en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
}
