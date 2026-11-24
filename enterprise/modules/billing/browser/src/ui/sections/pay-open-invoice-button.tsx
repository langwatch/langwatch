import { useUiHostServices } from "@langwatch/browser-host/capabilities";
import { Button } from "@langwatch/design-system/primitives";

import { usePaymentRecoveryPay } from "./use-payment-recovery-pay.ts";

/**
 * The plan card's action while a payment recovery case is open: the same Stripe invoice page
 * the payment banner opens, never a fresh checkout. Only people who can pay see it.
 */
export function PayOpenInvoiceButton({
  organizationId,
  label,
}: {
  organizationId: string;
  label: "Update card" | "Pay now";
}) {
  const { session } = useUiHostServices();
  const { pay, isPaying } = usePaymentRecoveryPay({ organizationId });
  if (!session.hasOrganizationPermission("subscription:manage")) return null;
  return (
    <Button
      data-testid="current-plan-pay-invoice-button"
      data-emphasis="primary"
      colorPalette="orange"
      size="sm"
      onClick={pay}
      loading={isPaying}
      disabled={isPaying}
    >
      {label}
    </Button>
  );
}
