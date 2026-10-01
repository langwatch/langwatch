import { SimEmpty, SimList, SimTime } from "@langwatch/sim-console";

import type { RequestEntry } from "./storage-api.ts";

export const RequestsTab = ({ requests }: { requests: RequestEntry[] }) => (
  <SimList
    items={requests}
    rowKey={(entry) => `${entry.at.toISOString()} ${entry.method} ${entry.bucket}/${entry.key}`}
    renderRow={(entry) => (
      <span>
        <strong>{entry.method}</strong> {entry.bucket}/{entry.key} <span>{entry.status}</span>{" "}
        <SimTime at={entry.at} />
      </span>
    )}
    empty={<SimEmpty title="No requests yet" hint="The last 500 S3 requests are listed here." />}
  />
);
