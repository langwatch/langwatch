import { Inline, Input, List, ListItem, Panel, Select } from "@langwatch/design-system-internal";
import { SimEmpty, SimSplit, SimTime } from "@langwatch/sim-console";
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
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const shown = objects.filter(
    (object) =>
      (bucket === "" || object.bucket === bucket) &&
      (needle === "" || objectKey(object).toLowerCase().includes(needle)),
  );
  const filtered = bucket !== "" || needle !== "";
  const open = objects.find((object) => objectKey(object) === selected);
  return (
    <>
      <Inline gap={3} wrap>
        <div className="storage-search">
          <Input
            label="Search objects"
            hideLabel
            type="search"
            placeholder="Key or bucket"
            autoComplete="off"
            value={query}
            onChange={setQuery}
          />
        </div>
        <div className="storage-bucket">
          <Select
            label="Bucket"
            hideLabel
            value={bucket}
            onChange={onBucket}
            options={[
              { value: "", label: "All buckets" },
              ...buckets.map((name) => ({ value: name, label: name })),
            ]}
          />
        </div>
      </Inline>
      <SimSplit
        list={
          <Panel
            title="Objects"
            meta={filtered ? `${shown.length} of ${objects.length}` : String(objects.length)}
          >
            {shown.length === 0 ? (
              <SimEmpty
                title={filtered ? "No objects match" : "No objects"}
                hint={
                  filtered
                    ? "Try another search or bucket."
                    : "Objects the stack uploads are listed here."
                }
              />
            ) : (
              <List label="Stored objects">
                {shown.map((object) => (
                  <ListItem
                    key={objectKey(object)}
                    current={objectKey(object) === selected}
                    onSelect={() => setSelected(objectKey(object))}
                    title={object.key}
                    description={`${object.bucket} · ${formatSize({ bytes: object.size })}`}
                    meta={<SimTime at={object.lastModified} />}
                  />
                ))}
              </List>
            )}
          </Panel>
        }
        detail={open ? <ObjectDetail object={open} /> : null}
        emptyDetail={
          <Panel>
            <SimEmpty
              title="Select an object"
              hint="Its metadata, headers, preview and download appear here."
            />
          </Panel>
        }
      />
    </>
  );
};
