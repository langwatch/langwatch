import {
  Badge,
  KeyValue,
  Panel,
  Stack,
  Text,
  type BadgeTone,
} from "@langwatch/design-system-internal";
import { SimCode, SimJson } from "@langwatch/sim-console";

import { channelLabel, type OutboundRecord } from "./outbound-api.ts";

const stamp = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "medium" });

export const verdictTone = {
  valid: "ok",
  invalid: "error",
  unchecked: "neutral",
} as const satisfies Record<string, BadgeTone>;

/** What the sim answered: the status, then how it came to (a fault, a dropped connection). */
const answerOf = ({ record }: { record: OutboundRecord }) => {
  if (record.dropped) return "Connection dropped, no answer";
  return record.faultId ? `${record.status} from fault ${record.faultId}` : String(record.status);
};

/** One record: its facts, headers, body and signature verdict, then what the sim parsed from it. */
export const RecordDetail = ({ record }: { record: OutboundRecord }) => {
  const headers = Object.entries(record.headers).toSorted(([a], [b]) => a.localeCompare(b));
  const facts = [
    { label: "Channel", value: channelLabel[record.channel], mono: false, copy: false },
    { label: "Target", value: record.target },
    { label: "Method", value: record.method, copy: false },
    { label: "Answered", value: answerOf({ record }), copy: false },
    { label: "Latency", value: `${record.latencyMs} ms`, copy: false },
    { label: "Received", value: stamp.format(record.receivedAt), mono: false, copy: false },
    { label: "Record id", value: record.id },
  ];
  const webhook = [
    { label: "Event id", value: record.eventId },
    { label: "Delivery id", value: record.deliveryId },
    { label: "Attempt", value: record.attempt === undefined ? undefined : String(record.attempt) },
  ].flatMap(({ label, value }) => (value === undefined ? [] : [{ label, value }]));
  return (
    <article data-testid="record-detail">
      <Stack gap={4}>
        <Panel
          title={record.target}
          meta={
            record.signature ? (
              <Badge tone={verdictTone[record.signature]}>Signature {record.signature}</Badge>
            ) : undefined
          }
        >
          <KeyValue items={[...facts, ...webhook]} />
        </Panel>
        <Panel title="Headers" meta={String(headers.length)}>
          {headers.length === 0 ? (
            <Text tone="muted">No headers were kept for this call.</Text>
          ) : (
            <KeyValue items={headers.map(([label, value]) => ({ label, value, copy: false }))} />
          )}
        </Panel>
        <Panel
          title="Body"
          meta={record.truncated ? <Badge tone="warn">Truncated</Badge> : undefined}
        >
          {record.body === "" ? (
            <Text tone="muted">The body was empty.</Text>
          ) : (
            <SimCode text={record.body} />
          )}
        </Panel>
        <SimJson value={record.parsed} label="Parsed by the sim" open={false} />
      </Stack>
    </article>
  );
};
