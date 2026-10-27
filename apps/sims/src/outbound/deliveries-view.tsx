import {
  Badge,
  IconButton,
  IconRefresh,
  Panel,
  Section,
  Stack,
  Table,
  type BadgeTone,
} from "@langwatch/design-system-internal";
import {
  SimEmpty,
  SimList,
  SimRefusal,
  SimSplit,
  SimTime,
  useSimPoll,
} from "@langwatch/sim-console";
import { useState } from "react";

import { fetchDeliveries, type Attempt, type Delivery } from "./outbound-api.ts";
import { verdictTone } from "./record-detail.tsx";

const statusTone = ({ attempt }: { attempt: Attempt }): BadgeTone => {
  if (attempt.dropped) return "error";
  return attempt.status >= 200 && attempt.status < 300 ? "ok" : "error";
};

const outcomeOf = ({ attempt }: { attempt: Delivery["attempts"][number] }) =>
  attempt.dropped ? "dropped" : String(attempt.status);

const summaryOf = ({ delivery }: { delivery: Delivery }) => {
  const last = delivery.attempts.at(-1);
  const outcome = last === undefined ? "no attempts" : outcomeOf({ attempt: last });
  return `${delivery.target} · ${delivery.attempts.length} attempt${delivery.attempts.length === 1 ? "" : "s"} · ${outcome}`;
};

const AttemptTimeline = ({ delivery }: { delivery: Delivery }) => (
  <article data-testid="delivery-detail">
    <Panel title={delivery.eventId} meta={String(delivery.attempts.length)}>
      <Table
        caption="Attempts in the order they arrived"
        rows={delivery.attempts}
        rowKey={(attempt) => attempt.id}
        columns={[
          {
            key: "attempt",
            header: "Attempt",
            cell: (attempt) => `#${attempt.attempt}`,
            width: "88px",
          },
          {
            key: "status",
            header: "Answered",
            cell: (attempt) => (
              <Badge tone={statusTone({ attempt })}>
                {attempt.dropped ? "dropped" : attempt.status}
              </Badge>
            ),
          },
          {
            key: "signature",
            header: "Signature",
            cell: (attempt) =>
              attempt.signature ? (
                <Badge tone={verdictTone[attempt.signature]}>{attempt.signature}</Badge>
              ) : (
                "none"
              ),
          },
          {
            key: "latency",
            header: "Latency",
            cell: (attempt) => `${attempt.latencyMs} ms`,
            mono: true,
          },
          { key: "at", header: "Received", cell: (attempt) => <SimTime at={attempt.receivedAt} /> },
        ]}
      />
    </Panel>
  </article>
);

/** Webhook deliveries grouped by event id, each with its attempts in order. */
export const DeliveriesView = () => {
  const deliveries = useSimPoll({ fetch: fetchDeliveries });
  const [selectedId, setSelectedId] = useState("");
  const items = deliveries.data ?? [];
  const selected = items.find((delivery) => delivery.eventId === selectedId) ?? items[0];

  return (
    <Section
      title="Deliveries"
      description="Each event the webhook module delivered, with every attempt it took to land."
    >
      <Stack gap={4}>
        {deliveries.error ? (
          <SimRefusal message={deliveries.error.message} />
        ) : (
          <SimSplit
            list={
              <SimList
                title="Events"
                meta={String(items.length)}
                actions={
                  <IconButton
                    label="Refresh"
                    icon={<IconRefresh />}
                    size="sm"
                    onClick={() => void deliveries.refresh()}
                  />
                }
                items={items}
                rowKey={(delivery) => delivery.eventId}
                selectedKey={selected?.eventId}
                onSelect={setSelectedId}
                renderRow={(delivery) => <span data-testid="delivery-row">{delivery.eventId}</span>}
                rowDescription={(delivery) => summaryOf({ delivery })}
                empty={
                  <SimEmpty
                    title="No deliveries yet"
                    hint="A webhook sent to this sim's /hooks/<name> URL shows up here, grouped by event id."
                  />
                }
              />
            }
            detail={selected ? <AttemptTimeline delivery={selected} /> : undefined}
            emptyDetail={
              <Panel>
                <SimEmpty title="Select an event" hint="Its attempts open here, oldest first." />
              </Panel>
            }
          />
        )}
      </Stack>
    </Section>
  );
};
