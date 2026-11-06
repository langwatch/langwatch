// Starts the Growth checkout the plans page asked for, once the page knows the seats and
// price. The address is cleaned first so a back step from Stripe cannot start it again.
import { useEffect, useRef } from "react";

import { useBillingHost } from "../../model/billing-host.ts";
import type { BillingInterval, Currency } from "../../model/billing-plans.ts";
import { parseCheckoutIntent, SUBSCRIPTION_PATH } from "../../model/checkout-intent.ts";

type Stage = "waiting" | "applied" | "done";

export function useCheckoutIntent({
  isReady,
  isUpgradeAvailable,
  billingPeriod,
  currency,
  setBillingPeriod,
  setCurrency,
  startCheckout,
}: {
  /** The plan, members and seat usage have answered, so the checkout prices the right seats. */
  isReady: boolean;
  /** The organization can buy Growth from this page. */
  isUpgradeAvailable: boolean;
  billingPeriod: BillingInterval;
  currency: Currency;
  setBillingPeriod: (interval: BillingInterval) => void;
  setCurrency: (currency: Currency) => void;
  startCheckout: () => Promise<void>;
}): void {
  const host = useBillingHost();
  const intent = parseCheckoutIntent(host.routeQuery());
  const stage = useRef<Stage>("waiting");

  useEffect(() => {
    if (!intent || !isReady || stage.current === "done") return;
    if (!isUpgradeAvailable) {
      stage.current = "done";
      host.replace(SUBSCRIPTION_PATH);
      return;
    }
    if (stage.current === "waiting") {
      stage.current = "applied";
      setBillingPeriod(intent.interval);
      setCurrency(intent.currency);
      return;
    }
    if (billingPeriod !== intent.interval || currency !== intent.currency) return;
    stage.current = "done";
    host.replace(SUBSCRIPTION_PATH);
    void startCheckout();
  });
}
