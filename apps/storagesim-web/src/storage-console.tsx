import { Section } from "@langwatch/design-system-internal";
import { SimConsole, useSimPoll } from "@langwatch/sim-console";
import { useState } from "react";

import { BucketsTab } from "./buckets-tab.tsx";
import { stackFromHost } from "./format.ts";
import { ObjectsTab } from "./objects-tab.tsx";
import { RequestsTab } from "./requests-tab.tsx";
import { storageApi } from "./storage-api.ts";
import { type TabId, useHashTab } from "./use-hash-tab.ts";

const HEADINGS: Record<TabId, { title: string; description: string }> = {
  buckets: {
    title: "Buckets",
    description: "Every bucket this stack's S3 clients write to. Objects stay on this machine.",
  },
  objects: {
    title: "Objects",
    description:
      "What the stack has stored: search by key, filter by bucket, open one to preview it.",
  },
  requests: {
    title: "Requests",
    description: "The last 500 S3 requests storagesim answered, newest first.",
  },
};

export const StorageConsole = () => {
  const { tab, open } = useHashTab();
  const [bucket, setBucket] = useState("");
  const buckets = useSimPoll({ fetch: storageApi.buckets });
  // Every object, filtered here: the buckets table reads each bucket's last write off it.
  const objects = useSimPoll({ fetch: () => storageApi.objects({ bucket: "" }) });
  const requests = useSimPoll({ fetch: storageApi.requests });
  const bucketNames = (buckets.data ?? []).map((entry) => entry.name);

  return (
    <SimConsole
      sim="storage"
      title="Storage"
      stackSlug={stackFromHost({ hostname: window.location.hostname })}
      tabs={[
        { id: "buckets", label: "Buckets", count: buckets.data?.length },
        { id: "objects", label: "Objects", count: objects.data?.length },
        { id: "requests", label: "Requests", count: requests.data?.length },
      ]}
      activeTab={tab}
      onTab={(id) => open(id === "objects" || id === "requests" ? id : "buckets")}
      status={
        buckets.error
          ? { tone: "error", text: buckets.error.message }
          : { tone: "ok", text: "storagesim is serving" }
      }
    >
      <Section title={HEADINGS[tab].title} description={HEADINGS[tab].description}>
        {tab === "buckets" ? (
          <BucketsTab
            buckets={buckets.data ?? []}
            objects={objects.data ?? []}
            onOpen={(name) => {
              setBucket(name);
              open("objects");
            }}
          />
        ) : null}
        {tab === "objects" ? (
          <ObjectsTab
            objects={objects.data ?? []}
            buckets={bucketNames}
            bucket={bucket}
            onBucket={setBucket}
          />
        ) : null}
        {tab === "requests" ? <RequestsTab requests={requests.data ?? []} /> : null}
      </Section>
    </SimConsole>
  );
};
