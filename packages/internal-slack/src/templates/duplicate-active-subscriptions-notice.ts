import { z } from "zod";

import { code, defineNotice } from "../notice.ts";

/** Two live plans on one account: seat changes refuse until an operator keeps one. */
export const duplicateActiveSubscriptionsNotice = defineNotice({
  id: "duplicate-active-subscriptions",
  title: "More than one active subscription",
  sentWhen:
    "A seat change is refused because an organization holds more than one active subscription; to the plan-limit channel, once a day per organization.",
  schema: z.object({
    organizationName: z.string(),
    adminName: z.string().nullish(),
    adminEmail: z.string().nullish(),
    planName: z.string(),
    subscriptionIds: z.array(z.string()).min(2),
    adminUrl: z.url().describe("The organization's subscriptions in Ops"),
  }),
  compose: (props) => ({
    tone: "warning",
    title: "More than one active subscription",
    fields: [
      { label: "Organization", value: props.organizationName },
      { label: "Admin", value: props.adminEmail ?? "unknown" },
      { label: "Plan", value: props.planName },
      ...props.subscriptionIds.map((id, index) => ({
        label: `Subscription ${index + 1}`,
        value: code(id),
      })),
    ],
    actions: [{ label: "Open org in admin", url: props.adminUrl, primary: true }],
  }),
  fixtures: {
    "an ops row beside a Stripe one": {
      organizationName: "Acme Robotics",
      adminName: "Morgan Ellis",
      adminEmail: "morgan@acme.example",
      planName: "Growth",
      subscriptionIds: ["subscription_2nVvAcmeNew", "subscription_2nVvAcmeOld"],
      adminUrl: "https://app.langwatch.ai/ops/cloud/subscriptions?q=organization_acme",
    },
  },
});
