import {
  ConfirmButton,
  IconButton,
  IconRefresh,
  Inline,
  Input,
  Panel,
  Section,
  Select,
  Stack,
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

import { channelLabel, channels, clearRecords, fetchRecords } from "./outbound-api.ts";
import { RecordDetail } from "./record-detail.tsx";

const channelOptions = [
  { value: "", label: "Every channel" },
  ...channels.map((channel) => ({ value: channel, label: channelLabel[channel] })),
];

/** Every Slack, webhook and SQS call, newest first, filtered by channel, target or event. */
export const RecordsView = () => {
  const records = useSimPoll({ fetch: fetchRecords });
  const [channel, setChannel] = useState("");
  const [target, setTarget] = useState("");
  const [eventId, setEventId] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const all = records.data ?? [];
  const targetNeedle = target.trim().toLowerCase();
  const eventNeedle = eventId.trim().toLowerCase();
  const items = all.filter(
    (record) =>
      (channel === "" || record.channel === channel) &&
      record.target.toLowerCase().includes(targetNeedle) &&
      (record.eventId ?? "").toLowerCase().includes(eventNeedle),
  );
  const selected = items.find((record) => record.id === selectedId) ?? items[0];
  const clear = async () => {
    await clearRecords().catch(() => undefined);
    await records.refresh();
  };

  return (
    <Section
      title="Records"
      description="Every Slack, webhook and SQS message this stack sends lands here and goes no further."
      actions={
        <ConfirmButton
          label="Clear records"
          confirmLabel="Clear all"
          disabled={all.length === 0}
          onConfirm={() => void clear()}
        />
      }
    >
      <Stack gap={4}>
        <Inline gap={3} wrap>
          <div className="outbound-select">
            <Select
              label="Channel"
              hideLabel
              options={channelOptions}
              value={channel}
              onChange={setChannel}
            />
          </div>
          <div className="outbound-search">
            <Input
              label="Filter by target"
              hideLabel
              type="search"
              placeholder="Target"
              autoComplete="off"
              value={target}
              onChange={setTarget}
            />
          </div>
          <div className="outbound-search">
            <Input
              label="Filter by event id"
              hideLabel
              type="search"
              placeholder="Event id"
              autoComplete="off"
              value={eventId}
              onChange={setEventId}
            />
          </div>
        </Inline>
        {records.error ? (
          <SimRefusal message={records.error.message} />
        ) : (
          <SimSplit
            list={
              <SimList
                title="Records"
                meta={
                  items.length === all.length
                    ? String(items.length)
                    : `${items.length} of ${all.length}`
                }
                actions={
                  <IconButton
                    label="Refresh"
                    icon={<IconRefresh />}
                    size="sm"
                    onClick={() => void records.refresh()}
                  />
                }
                items={items}
                rowKey={(record) => record.id}
                selectedKey={selected?.id}
                onSelect={setSelectedId}
                renderRow={(record) => <span data-testid="record-row">{record.target}</span>}
                rowDescription={(record) =>
                  `${channelLabel[record.channel]} · ${record.method} · ${record.dropped ? "dropped" : record.status}`
                }
                rowMeta={(record) => <SimTime at={record.receivedAt} />}
                empty={
                  all.length === 0 ? (
                    <SimEmpty
                      title="No records yet"
                      hint="Start the stack with haven up +outbound; the Slack, webhook and SQS calls it makes land here."
                    />
                  ) : (
                    <SimEmpty
                      title="No records match"
                      hint="Try another channel, target or event id."
                    />
                  )
                }
              />
            }
            detail={selected ? <RecordDetail record={selected} /> : undefined}
            emptyDetail={
              <Panel>
                <SimEmpty
                  title="Select a record"
                  hint="Its headers, body and signature verdict open here."
                />
              </Panel>
            }
          />
        )}
      </Stack>
    </Section>
  );
};
