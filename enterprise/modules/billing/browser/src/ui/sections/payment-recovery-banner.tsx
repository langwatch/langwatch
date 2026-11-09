import { useUiHostServices } from "@langwatch/browser-host/capabilities";
import { uiLeaveTo } from "@langwatch/browser-host/navigation";
import { Banner, BannerAction } from "@langwatch/design-system/banner";
import type { PaymentRecoveryBannerProps } from "@langwatch/enterprise-billing-client";
import { nowInstant } from "@langwatch/time";

import { billingApi } from "../../behavior/billing-api.ts";
import { paymentRecoveryBanner } from "../../model/payment-recovery-banner.ts";

/**
 * The failed payment banner and paused notice, lent to the shell's banner stack.
 * People who can pay get the date and a button to Stripe's page for the open invoice.
 */
export function PaymentRecoveryBanner({
  organizationId,
  organizationName,
}: PaymentRecoveryBannerProps) {
  const { session, feedback } = useUiHostServices();
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
  const payLink = billingApi.subscription.paymentRecoveryPayLink.useMutation();

  const copy = paymentRecoveryBanner({
    state,
    canPay,
    organizationName,
    accessStopsAt: details.data?.accessStopsAt ?? null,
    now: nowInstant().epochMilliseconds,
  });
  if (!copy) return null;

  const pay = () =>
    payLink.mutate(
      { organizationId },
      {
        onSuccess: (link) => uiLeaveTo(link.url),
        onError: (error) =>
          feedback.failed({ error, fallbackTitle: "The payment page could not be opened" }),
      },
    );

  return (
    <Banner
      status={copy.status}
      placement="top"
      title={copy.title}
      data-testid="payment-recovery-banner"
      action={
        copy.action ? (
          <BannerAction onClick={pay} loading={payLink.isPending}>
            {copy.action}
          </BannerAction>
        ) : undefined
      }
    >
      {copy.body}
    </Banner>
  );
}
