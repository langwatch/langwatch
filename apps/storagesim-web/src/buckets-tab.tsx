import { Panel, Table } from "@langwatch/design-system-internal";
import { SimEmpty, SimTime } from "@langwatch/sim-console";

import { formatSize } from "./format.ts";
import type { Bucket, StoredObject } from "./storage-api.ts";

const lastWrite = ({ objects, bucket }: { objects: StoredObject[]; bucket: string }) =>
  objects
    .filter((object) => object.bucket === bucket)
    .map((object) => object.lastModified)
    .toSorted((a, b) => b.getTime() - a.getTime())[0];

export const BucketsTab = ({
  buckets,
  objects,
  onOpen,
}: {
  buckets: Bucket[];
  objects: StoredObject[];
  onOpen: (bucket: string) => void;
}) => (
  <Panel title="Buckets" meta={String(buckets.length)}>
    <Table
      caption="Buckets"
      rows={buckets}
      rowKey={(bucket) => bucket.name}
      onRowClick={(bucket) => onOpen(bucket.name)}
      empty={
        <SimEmpty
          title="No buckets yet"
          hint="A bucket appears when the first object is uploaded."
        />
      }
      columns={[
        { key: "name", header: "Name", cell: (bucket) => bucket.name, mono: true },
        {
          key: "objects",
          header: "Objects",
          cell: (bucket) => bucket.objects,
          align: "end",
          width: "8rem",
        },
        {
          key: "size",
          header: "Size",
          cell: (bucket) => formatSize({ bytes: bucket.size }),
          align: "end",
          width: "8rem",
        },
        {
          key: "written",
          header: "Last write",
          cell: (bucket) => {
            const at = lastWrite({ objects, bucket: bucket.name });
            return at === undefined ? "" : <SimTime at={at} />;
          },
          align: "end",
          width: "11rem",
          muted: true,
          hideOnNarrow: true,
        },
      ]}
    />
  </Panel>
);
