import { Section } from "@langwatch/design-system-internal";
import { SimConsole, SimRefusal, useSimPoll } from "@langwatch/sim-console";
import { useCallback, useEffect, useState } from "react";

import { BucketsTab } from "./buckets-tab.tsx";
import { stackFromHost } from "./format.ts";
import { ObjectsTab } from "./objects-tab.tsx";
import { RequestsTab } from "./requests-tab.tsx";
import { storageApi } from "./storage-api.ts";

const TABS = ["buckets", "objects", "requests"] as const;
type TabId = (typeof TABS)[number];

const fromHash = () => TABS.find((tab) => tab === window.location.hash.slice(1)) ?? "buckets";

/** The open tab, kept in location.hash so a tab can be linked to. */
const useHashTab = () => {
  const [tab, setTab] = useState<TabId>(fromHash);
  useEffect(() => {
    const onChange = () => setTab(fromHash());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  const open = useCallback((next: TabId) => {
    window.location.hash = next;
    setTab(next);
  }, []);
  return { tab, open };
};

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
  const [refusal, setRefusal] = useState("");
  /** Runs one control call, then refreshes what it changed; a refusal shows above the tab. */
  const act = (call: () => Promise<void>) => {
    setRefusal("");
    void call()
      .catch((caught: unknown) => setRefusal(caught instanceof Error ? caught.message : "Refused"))
      .finally(() => {
        void buckets.refresh();
        void objects.refresh();
      });
  };

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
        {refusal === "" ? null : <SimRefusal message={refusal} />}
        {tab === "buckets" ? (
          <BucketsTab
            buckets={buckets.data ?? []}
            objects={objects.data ?? []}
            onOpen={(name) => {
              setBucket(name);
              open("objects");
            }}
            onSeed={() => act(storageApi.seed)}
          />
        ) : null}
        {tab === "objects" ? (
          <ObjectsTab
            objects={objects.data ?? []}
            buckets={bucketNames}
            bucket={bucket}
            onBucket={setBucket}
            onClear={(name) => act(() => storageApi.clear({ bucket: name }))}
            onDelete={(object) => act(() => storageApi.remove(object))}
          />
        ) : null}
        {tab === "requests" ? <RequestsTab requests={requests.data ?? []} /> : null}
      </Section>
    </SimConsole>
  );
};
