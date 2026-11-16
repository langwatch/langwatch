import { useUiHostServices } from "@langwatch/browser-host/capabilities";
import { Banner, BannerAction } from "@langwatch/design-system/banner";
import type { PaymentRecoveryBannerProps } from "@langwatch/enterprise-billing-client";
import { nowInstant } from "@langwatch/time";

import { billingApi } from "../../behavior/billing-api.ts";
import { paymentRecoveryBanner } from "../../model/payment-recovery-banner.ts";
import { usePaymentRecoveryPay } from "./use-payment-recovery-pay.ts";

/**
 * The failed payment banner and paused notice, lent to the shell's banner stack.
 * People who can pay get the date and a button to Stripe's page for the open invoice.
 */
export function PaymentRecoveryBanner({
  organizationId,
  organizationName,
}: PaymentRecoveryBannerProps) {
  const { session } = useUiHostServices();
  const canPay = session.hasOrganizationPermission("subscription:manage");
  const summary = billingApi.subscription.paymentRecovery.useQuery(
    { organizationId },
    { retry: false },
  );
  const state = summary.data?.state ?? "none";
  const details = billingApi.subscription.paymentRecoveryDetails.useQuery(
    { organizationId },
    { enabled: canPay && state !== "none", retry: false },
  );
  const { pay, isPaying } = usePaymentRecoveryPay({ organizationId });

  const copy = paymentRecoveryBanner({
    state,
    canPay,
    organizationName,
    accessStopsAt: details.data?.accessStopsAt ?? null,
    now: nowInstant().epochMilliseconds,
  });
  if (!copy) return null;

  return (
    <Banner
      status={copy.status}
      placement="top"
      title={copy.title}
      data-testid="payment-recovery-banner"
      action={
        copy.action ? (
          <BannerAction onClick={pay} loading={isPaying}>
            {copy.action}
          </BannerAction>
        ) : undefined
      }
    >
      {copy.body}
    </Banner>
  );
}
