import { z } from "zod";

import { count, defineNotice } from "../notice.ts";

export const licensePurchaseNotice = defineNotice({
  id: "license-purchase",
  title: "New license purchase",
  sentWhen: "Somebody buys a self-hosted license; to the subscriptions channel.",
  schema: z.object({
    buyerEmail: z.string(),
    planType: z.string(),
    seats: z.number(),
    amountPaid: z.number().int().describe("In the currency's minor unit, as Stripe reports it"),
    currency: z.string().length(3),
  }),
  compose: (props) => ({
    tone: "win",
    title: "New license purchase",
    fields: [
      { label: "Buyer", value: props.buyerEmail },
      { label: "Plan", value: props.planType },
      { label: "Seats", value: count(props.seats) },
      {
        label: "Amount",
        value: new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: props.currency,
        }).format(props.amountPaid / 100),
      },
    ],
  }),
  fixtures: {
    "an annual licence": {
      buyerEmail: "morgan@acme.example",
      planType: "ENTERPRISE",
      seats: 25,
      amountPaid: 1_250_000,
      currency: "usd",
    },
  },
});
