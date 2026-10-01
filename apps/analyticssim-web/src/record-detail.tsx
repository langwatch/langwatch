import { SimJson, SimTime } from "@langwatch/sim-console";

import type { AnalyticsRecord } from "./analytics-api.ts";

export const providerLabel = { posthog: "PostHog", customerio: "Customer.io" } as const;

/** One record: its facts, its properties or traits, then the call as the vendor got it. */
export const RecordDetail = ({ record }: { record: AnalyticsRecord }) => (
  <article className="analytics-record" data-testid="record-detail">
    <header className="analytics-facts">
      <h2>{record.name || record.kind}</h2>
      <span>{providerLabel[record.provider]}</span>
      <span>{record.kind}</span>
      <span>{record.distinctId || "(no id)"}</span>
      <SimTime at={record.receivedAt} />
    </header>
    <h3>Properties</h3>
    <SimJson value={record.properties} />
    <h3>Raw call</h3>
    <SimJson value={record.raw} />
  </article>
);
