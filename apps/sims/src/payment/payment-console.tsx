import { SimConsole, useSimPoll } from "@langwatch/sim-console";
import { useState } from "react";

import { fetchStatus } from "./payment-api.ts";
import {
  CustomersView,
  EventsView,
  InvoicesView,
  SessionsView,
  SubscriptionsView,
} from "./payment-views.tsx";

const views = {
  customers: { label: "Customers", view: CustomersView },
  subscriptions: { label: "Subscriptions", view: SubscriptionsView },
  checkout: { label: "Checkout", view: SessionsView },
  invoices: { label: "Invoices", view: InvoicesView },
  events: { label: "Webhook events", view: EventsView },
} as const;

type ViewId = keyof typeof views;

const viewIds = Object.keys(views).filter((id): id is ViewId => id in views);

/** The Stripe stand-in's console: what it holds, read-only. */
export const PaymentConsole = () => {
  const status = useSimPoll({ fetch: fetchStatus });
  const [active, setActive] = useState<ViewId>("customers");
  const View = views[active].view;
  const counts: Partial<Record<ViewId, number>> = {
    customers: status.data?.customers,
    subscriptions: status.data?.subscriptions,
    invoices: status.data?.invoices,
  };

  return (
    <SimConsole
      sim="payment"
      title="Payment"
      stackSlug={status.data?.stack ?? ""}
      tabs={viewIds.map((id) => ({ id, label: views[id].label, count: counts[id] }))}
      activeTab={active}
      onTab={(id) => setActive(viewIds.find((known) => known === id) ?? "customers")}
      status={
        status.error
          ? { tone: "error", text: status.error.message }
          : {
              tone: status.data?.held ? "warn" : "ok",
              text: status.data?.webhookUrl
                ? `Webhooks to ${status.data.webhookUrl}${status.data.held ? " (held)" : ""}`
                : "Webhook delivery is not configured",
            }
      }
    >
      <View />
    </SimConsole>
  );
};
