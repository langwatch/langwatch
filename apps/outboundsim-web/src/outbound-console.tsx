import { SimConsole, useSimPoll } from "@langwatch/sim-console";
import { useState } from "react";

import { DeliveriesView } from "./deliveries-view.tsx";
import { FaultsView } from "./faults-view.tsx";
import { fetchStatus } from "./outbound-api.ts";
import { RecordsView } from "./records-view.tsx";
import { SetupView } from "./setup-view.tsx";

const views = {
  records: { label: "Records", view: RecordsView },
  deliveries: { label: "Deliveries", view: DeliveriesView },
  faults: { label: "Faults", view: FaultsView },
  setup: { label: "Setup", view: SetupView },
} as const;

type ViewId = keyof typeof views;

const viewIds = Object.keys(views).filter((id): id is ViewId => id in views);

/** The outbound simulator's console: Slack, webhook and SQS records, deliveries, faults, setup. */
export const OutboundConsole = () => {
  const status = useSimPoll({ fetch: fetchStatus });
  const [active, setActive] = useState<ViewId>("records");
  const View = views[active].view;

  return (
    <SimConsole
      sim="outbound"
      title="Outbound"
      stackSlug={status.data?.stack ?? ""}
      tabs={viewIds.map((id) => ({
        id,
        label: views[id].label,
        count: id === "records" ? status.data?.records : undefined,
      }))}
      activeTab={active}
      onTab={(id) => setActive(viewIds.find((known) => known === id) ?? "records")}
      status={
        status.error
          ? { tone: "error", text: status.error.message }
          : { tone: "ok", text: `Slack, webhooks and SQS at ${status.data?.baseUrl ?? "…"}` }
      }
    >
      <View />
    </SimConsole>
  );
};
