import { Badge, Panel, Table } from "@langwatch/design-system-internal";
import { SimEmpty, SimTime } from "@langwatch/sim-console";

import { statusTone } from "./format.ts";
import type { RequestEntry } from "./storage-api.ts";

const pathOf = ({ bucket, key }: RequestEntry) => `/${[bucket, key].filter(Boolean).join("/")}`;

export const RequestsTab = ({ requests }: { requests: RequestEntry[] }) => (
  <Panel title="Requests" meta={String(requests.length)}>
    <Table
      caption="S3 requests"
      rows={requests}
      rowKey={(entry) => `${entry.at.toISOString()} ${entry.method} ${pathOf(entry)}`}
      empty={<SimEmpty title="No requests yet" hint="The last 500 S3 requests are listed here." />}
      columns={[
        {
          key: "method",
          header: "Method",
          cell: (entry) => entry.method,
          mono: true,
          width: "6rem",
        },
        { key: "path", header: "Path", cell: pathOf, mono: true },
        {
          key: "status",
          header: "Status",
          cell: (entry) => <Badge tone={statusTone(entry)}>{entry.status}</Badge>,
          width: "6rem",
        },
        {
          key: "at",
          header: "Time",
          cell: (entry) => <SimTime at={entry.at} />,
          align: "end",
          width: "11rem",
          muted: true,
          hideOnNarrow: true,
        },
      ]}
    />
  </Panel>
);
