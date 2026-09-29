import { z } from "zod";

import { code, defineNotice } from "../notice.ts";

export const billingThresholdFailureNotice = defineNotice({
  id: "billing-threshold-failure",
  title: "Annual events billing threshold not set",
  sentWhen:
    "Checkout could not give an annual subscription its events billing threshold; to the subscriptions channel.",
  schema: z.object({
    stripeSubscriptionId: z.string(),
    reason: z.string(),
    stripeTestMode: z.boolean().default(false).describe("Links to Stripe's test dashboard"),
  }),
  compose: (props) => ({
    tone: "failure",
    title: "Annual events billing threshold not set",
    fields: [
      { label: "Stripe subscription", value: code(props.stripeSubscriptionId) },
      { label: "Reason", value: props.reason },
    ],
    note:
      "This subscription will bill its event overage as one renewal invoice until the " +
      "threshold is applied - re-run the backfill or set it manually.",
    actions: [
      {
        label: "Open in Stripe",
        url: stripeSubscriptionUrl(props),
        primary: true,
      },
    ],
  }),
  fixtures: {
    "a Stripe refusal": {
      stripeSubscriptionId: "sub_1QxAcmeExample",
      reason: "billing_thresholds.amount_gte must be at least 50",
    },
    "in test mode": {
      stripeSubscriptionId: "sub_1QxAcmeExample",
      reason: "No such price",
      stripeTestMode: true,
    },
  },
});

function stripeSubscriptionUrl({
  stripeSubscriptionId,
  stripeTestMode,
}: {
  stripeSubscriptionId: string;
  stripeTestMode: boolean;
}): string {
  const mode = stripeTestMode ? "test/" : "";
  return `https://dashboard.stripe.com/${mode}subscriptions/${encodeURIComponent(stripeSubscriptionId)}`;
}
