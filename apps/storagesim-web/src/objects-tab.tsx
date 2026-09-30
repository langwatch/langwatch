import { SimEmpty, SimList, SimSplit, SimTime } from "@langwatch/sim-console";
import { useState } from "react";

import { formatSize } from "./format.ts";
import { ObjectDetail } from "./object-detail.tsx";
import type { StoredObject } from "./storage-api.ts";

const objectKey = ({ bucket, key }: StoredObject) => `${bucket}/${key}`;

export const ObjectsTab = ({
  objects,
  buckets,
  bucket,
  onBucket,
}: {
  objects: StoredObject[];
  buckets: string[];
  bucket: string;
  onBucket: (bucket: string) => void;
}) => {
  const [selected, setSelected] = useState("");
  const open = objects.find((object) => objectKey(object) === selected);
  return (
    <>
      <label>
        Bucket{" "}
        <select value={bucket} onChange={(event) => onBucket(event.target.value)}>
          <option value="">All buckets</option>
          {buckets.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <SimSplit
        list={
          <SimList
            items={objects}
            rowKey={objectKey}
            selectedKey={selected}
            onSelect={setSelected}
            renderRow={(object) => (
              <span>
                <strong>{object.key}</strong> {formatSize({ bytes: object.size })}{" "}
                <span>{object.contentType}</span> <code>{object.etag}</code>{" "}
                <SimTime at={object.lastModified} />
              </span>
            )}
            empty={<SimEmpty title="No objects" hint="Uploaded objects are listed here." />}
          />
        }
        detail={open ? <ObjectDetail object={open} /> : null}
        emptyDetail={
          <SimEmpty
            title="Select an object"
            hint="Its headers, preview and download appear here."
          />
        }
      />
    </>
  );
};
