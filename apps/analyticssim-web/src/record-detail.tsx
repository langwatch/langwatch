import { Badge, KeyValue, Panel, Stack, Text } from "@langwatch/design-system-internal";
import { SimJson } from "@langwatch/sim-console";

import type { AnalyticsRecord } from "./analytics-api.ts";

export const providerLabel = { posthog: "PostHog", customerio: "Customer.io" } as const;

const stamp = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "medium" });

/** A property as the vendor got it: strings bare, anything else as compact JSON. */
const shown = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value : JSON.stringify(value);

/** One record: its facts, its properties or traits, then the call as the vendor got it. */
export const RecordDetail = ({ record }: { record: AnalyticsRecord }) => {
  const properties = Object.entries(record.properties).toSorted(([a], [b]) => a.localeCompare(b));
  return (
    <article data-testid="record-detail">
      <Stack gap={4}>
        <Panel
          title={record.name || record.kind}
          meta={<Badge>{providerLabel[record.provider]}</Badge>}
        >
          <KeyValue
            items={[
              {
                label: "Provider",
                value: providerLabel[record.provider],
                mono: false,
                copy: false,
              },
              { label: "Kind", value: record.kind, copy: false },
              { label: "Distinct id", value: record.distinctId || "(no id)" },
              {
                label: "Received",
                value: stamp.format(record.receivedAt),
                mono: false,
                copy: false,
              },
              { label: "Record id", value: record.id },
            ]}
          />
        </Panel>
        <Panel
          title={record.kind === "identify" ? "Traits" : "Properties"}
          meta={String(properties.length)}
        >
          {properties.length === 0 ? (
            <Text tone="muted">None were sent with this call.</Text>
          ) : (
            <KeyValue
              items={properties.map(([label, value]) => ({ label, value: shown({ value }) }))}
            />
          )}
        </Panel>
        <SimJson value={record.raw} label="Raw call JSON" open={false} />
      </Stack>
    </article>
  );
};
