import { useUiDeployment } from "@langwatch/browser-host/capabilities";
import {
  BillingPriceCatalogue,
  type Currency,
  formatPrice,
  getGrowthSeatPriceCents,
} from "@langwatch/enterprise-billing-contract";

/**
 * Growth's monthly price for one full seat in `currency`, from the Stripe catalogue this
 * deployment is priced against. Undefined when the catalogue holds no such price.
 */
export function useGrowthSeatPrice({ currency }: { currency: Currency }): string | undefined {
  const { isDevelopment } = useUiDeployment();
  try {
    const prices = BillingPriceCatalogue.create(isDevelopment ? "test" : "live").prices;
    return formatPrice({ cents: getGrowthSeatPriceCents(prices)[currency].monthly, currency });
  } catch {
    return undefined;
  }
}
