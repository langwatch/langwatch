import { useMemo } from "react";

import { useBillingHost } from "../model/billing-host.ts";
import { BillingPricingService } from "../model/billing-pricing.service.ts";

/** Prices from the Stripe catalogue the host says this deployment is priced against. */
export function useBillingPricingService(): BillingPricingService {
  const environment = useBillingHost().stripeEnvironment();
  return useMemo(() => BillingPricingService.create(environment), [environment]);
}
