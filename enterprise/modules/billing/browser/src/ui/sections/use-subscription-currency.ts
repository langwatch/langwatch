import { Currency as PrismaCurrency } from "@langwatch/enterprise-billing-contract";
import { useEffect, useState } from "react";

import { billingApi } from "../../behavior/billing-api.ts";
import type { Currency } from "../../model/billing-plans.ts";

/** The currency the reader picked, else the one detected for them, else euros. */
export function useSubscriptionCurrency(organizationId: string | undefined) {
  const [selectedCurrency, setSelectedCurrency] = useState<Currency | null>(null);
  const detectedCurrency = billingApi.currency.detectCurrency.useQuery(
    {},
    { enabled: !!organizationId },
  );

  useEffect(() => {
    setSelectedCurrency(null);
  }, [organizationId]);

  return {
    currency: selectedCurrency ?? detectedCurrency.data?.currency ?? PrismaCurrency.EUR,
    setSelectedCurrency,
    isLoading: detectedCurrency.isLoading,
  };
}
