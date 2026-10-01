import { SimEmpty, SimList } from "@langwatch/sim-console";

import { formatSize } from "./format.ts";
import type { Bucket } from "./storage-api.ts";

export const BucketsTab = ({
  buckets,
  onOpen,
}: {
  buckets: Bucket[];
  onOpen: (bucket: string) => void;
}) => (
  <SimList
    items={buckets}
    rowKey={(bucket) => bucket.name}
    onSelect={(name) => onOpen(name)}
    renderRow={(bucket) => (
      <span>
        <strong>{bucket.name}</strong>{" "}
        <span>
          {bucket.objects} {bucket.objects === 1 ? "object" : "objects"},{" "}
          {formatSize({ bytes: bucket.size })}
        </span>
      </span>
    )}
    empty={
      <SimEmpty title="No buckets yet" hint="A bucket appears when the first object is uploaded." />
    }
  />
);
