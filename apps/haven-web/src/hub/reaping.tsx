import { Badge, Panel, Table, type TableColumn } from "@langwatch/design-system-internal";

import type { HubEvent } from "../shared/contract.ts";
import { formatAge } from "../shared/format.ts";

/** What the daemon reclaimed, newest first: stacks, test containers, processes, databases. */
export const Reaping = ({ events, now }: { events: HubEvent[]; now: number }) => {
  const columns: TableColumn<HubEvent>[] = [
    {
      key: "age",
      header: "When",
      width: "96px",
      mono: true,
      muted: true,
      cell: (event) => formatAge({ at: event.at, now }),
    },
    { key: "kind", header: "Kind", width: "128px", cell: (event) => <Badge>{event.kind}</Badge> },
    { key: "target", header: "Target", mono: true, cell: (event) => event.target },
    {
      key: "reason",
      header: "Why",
      muted: true,
      hideOnNarrow: true,
      cell: (event) => event.reason,
    },
  ];
  return (
    <Panel>
      <Table
        columns={columns}
        rows={events}
        rowKey={(event) => `${event.at ?? ""}:${event.kind}:${event.target}`}
        caption="Recent reaping"
      />
    </Panel>
  );
};
