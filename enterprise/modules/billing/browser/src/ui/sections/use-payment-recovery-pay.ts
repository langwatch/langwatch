import { useUiHostServices } from "@langwatch/browser-host/capabilities";
import { uiLeaveTo } from "@langwatch/browser-host/navigation";

import { billingApi } from "../../behavior/billing-api.ts";

/**
 * Leaves for Stripe's page for the open recovery invoice, where the reader pays it or
 * updates the card (enterprise/modules/billing/specs/payment-recovery.feature).
 */
export function usePaymentRecoveryPay({ organizationId }: { organizationId: string }) {
  const { feedback } = useUiHostServices();
  const payLink = billingApi.subscription.paymentRecoveryPayLink.useMutation();

  const pay = () =>
    payLink.mutate(
      { organizationId },
      {
        onSuccess: (link) => uiLeaveTo(link.url),
        onError: (error) =>
          feedback.failed({ error, fallbackTitle: "The payment page could not be opened" }),
      },
    );

  return { pay, isPaying: payLink.isPending };
}
