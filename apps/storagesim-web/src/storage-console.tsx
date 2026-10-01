import { SimConsole, useSimPoll } from "@langwatch/sim-console";
import { useCallback, useEffect, useState } from "react";

import { BucketsTab } from "./buckets-tab.tsx";
import { stackFromHost } from "./format.ts";
import { ObjectsTab } from "./objects-tab.tsx";
import { RequestsTab } from "./requests-tab.tsx";
import { storageApi } from "./storage-api.ts";
import { useHashTab } from "./use-hash-tab.ts";

export const StorageConsole = () => {
  const { tab, open } = useHashTab();
  const [bucket, setBucket] = useState("");
  const buckets = useSimPoll({ fetch: storageApi.buckets });
  const listObjects = useCallback(() => storageApi.objects({ bucket }), [bucket]);
  const objects = useSimPoll({ fetch: listObjects });
  const refreshObjects = objects.refresh;
  useEffect(() => {
    void refreshObjects();
  }, [bucket, refreshObjects]);
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
      {tab === "buckets" ? (
        <BucketsTab
          buckets={buckets.data ?? []}
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
    </SimConsole>
  );
};
