import { z } from "zod";

import { code, defineNotice } from "../notice.ts";

/** An Enterprise charge failed: it is never paused, so the account team follows up. */
export const accountPaymentFailedNotice = defineNotice({
  id: "account-payment-failed",
  title: "Enterprise payment failed",
  sentWhen:
    "A charge on an Enterprise organization's invoice fails; to the subscriptions channel. The organization keeps its plan.",
  schema: z.object({
    organizationId: z.string(),
    organizationName: z.string(),
    stripeInvoiceId: z.string(),
    amount: z.string().describe("The invoice total, formatted in its currency"),
    stripeTestMode: z.boolean().default(false).describe("Links to Stripe's test dashboard"),
  }),
  compose: (props) => ({
    tone: "failure",
    title: "Enterprise payment failed",
    fields: [
      { label: "Organization", value: props.organizationName },
      { label: "Organization id", value: code(props.organizationId) },
      { label: "Amount", value: props.amount },
      { label: "Stripe invoice", value: code(props.stripeInvoiceId) },
    ],
    note: "Enterprise organizations are never paused. Follow up with the account.",
    actions: [{ label: "Open in Stripe", url: stripeInvoiceUrl(props), primary: true }],
  }),
  fixtures: {
    "a declined card": {
      organizationId: "organization_KAXYxPR8MU",
      organizationName: "ACME",
      stripeInvoiceId: "in_1QxAcmeExample",
      amount: "€4,235.00",
    },
  },
});

function stripeInvoiceUrl({
  stripeInvoiceId,
  stripeTestMode,
}: {
  stripeInvoiceId: string;
  stripeTestMode: boolean;
}): string {
  const mode = stripeTestMode ? "test/" : "";
  return `https://dashboard.stripe.com/${mode}invoices/${encodeURIComponent(stripeInvoiceId)}`;
}
