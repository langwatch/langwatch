/**
 * The Growth upgrade another page asks the subscription page to open, carried in the address:
 * the seat dialog opens there, in the interval and currency asked for when the address names them.
 * @see specs/licensing/seat-buying.feature
 */

import { Currency } from "@langwatch/enterprise-billing-contract";
import { z } from "zod";

import type { BillingInterval } from "./billing-plans.ts";

export const SUBSCRIPTION_PATH = "/settings/subscription";

const checkoutIntentSchema = z.object({
  checkout: z.literal("growth"),
  interval: z.enum(["monthly", "annual"]).optional(),
  currency: z.enum([Currency.EUR, Currency.USD]).optional(),
});

export type CheckoutIntent = Omit<z.infer<typeof checkoutIntentSchema>, "checkout">;

/** The subscription address that opens the Growth seat dialog in the page's own choices. */
export const UPGRADE_DIALOG_HREF = `${SUBSCRIPTION_PATH}?checkout=growth`;

/** The subscription address that starts a Growth checkout for this interval and currency. */
export function checkoutIntentHref({
  interval,
  currency,
}: {
  interval: BillingInterval;
  currency: NonNullable<CheckoutIntent["currency"]>;
}): string {
  const query = new URLSearchParams({ checkout: "growth", interval, currency });
  return `${SUBSCRIPTION_PATH}?${query.toString()}`;
}

/** The checkout the address asks for, or null when it asks for none or names a bad value. */
export function parseCheckoutIntent(
  query: Readonly<Record<string, string | undefined>>,
): CheckoutIntent | null {
  const parsed = checkoutIntentSchema.safeParse(query);
  if (!parsed.success) return null;
  return { interval: parsed.data.interval, currency: parsed.data.currency };
}
