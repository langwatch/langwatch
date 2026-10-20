import {
  Badge,
  Button,
  Checkbox,
  ConfirmButton,
  Inline,
  Input,
  Panel,
  Section,
  Select,
  Stack,
  Table,
} from "@langwatch/design-system-internal";
import { SimRefusal, useSimPoll } from "@langwatch/sim-console";
import { useState } from "react";

import {
  addFault,
  channelLabel,
  channels,
  clearFaults,
  fetchFaults,
  removeFault,
  type Channel,
  type Fault,
  type FaultInput,
} from "./outbound-api.ts";

const channelOptions = channels.map((channel) => ({
  value: channel,
  label: channelLabel[channel],
}));

const blank = {
  channel: "webhook",
  target: "*",
  status: "500",
  latencyMs: "0",
  retryAfter: "",
  times: "",
  drop: false,
};

const channelOf = ({ value }: { value: string }): Channel =>
  channels.find((channel) => channel === value) ?? "webhook";

const optionalNumber = ({ text }: { text: string }) =>
  text.trim() === "" ? undefined : Number(text);

/** Text fields in, a fault out; the sim validates it, so a bad number is refused there. */
const faultOf = ({ form }: { form: typeof blank }): FaultInput => ({
  channel: channelOf({ value: form.channel }),
  target: form.target.trim() || "*",
  status: Number(form.status),
  latencyMs: Number(form.latencyMs),
  retryAfter: optionalNumber({ text: form.retryAfter }),
  times: optionalNumber({ text: form.times }),
  drop: form.drop,
});

const answerOf = ({ fault }: { fault: Fault }) =>
  fault.drop ? "drops the connection" : String(fault.status);

/** The faults the sim answers with: listed, added from a form, removed singly or all at once. */
export const FaultsView = () => {
  const faults = useSimPoll({ fetch: fetchFaults });
  const [form, setForm] = useState(blank);
  const [refusal, setRefusal] = useState("");
  const items = faults.data ?? [];
  const set = (patch: Partial<typeof blank>) => setForm({ ...form, ...patch });
  const run = async ({ action }: { action: () => Promise<void> }) => {
    setRefusal("");
    await action().catch((error: unknown) =>
      setRefusal(error instanceof Error ? error.message : String(error)),
    );
    await faults.refresh();
  };

  return (
    <Section
      title="Faults"
      description="A fault answers calls to a channel and target with a chosen status, delay or dropped connection. The first match wins."
      actions={
        <ConfirmButton
          label="Clear faults"
          confirmLabel="Clear all"
          disabled={items.length === 0}
          onConfirm={() => void run({ action: clearFaults })}
        />
      }
    >
      <Stack gap={4}>
        <Panel title="Add a fault">
          <Stack gap={3}>
            <Inline gap={3} wrap>
              <div className="outbound-select">
                <Select
                  label="Channel"
                  options={channelOptions}
                  value={form.channel}
                  onChange={(channel) => set({ channel })}
                />
              </div>
              <div className="outbound-search">
                <Input
                  label="Target"
                  hint="A glob; * matches every target."
                  value={form.target}
                  onChange={(target) => set({ target })}
                />
              </div>
              <div className="outbound-field">
                <Input
                  label="Status"
                  inputMode="numeric"
                  value={form.status}
                  onChange={(status) => set({ status })}
                />
              </div>
              <div className="outbound-field">
                <Input
                  label="Latency (ms)"
                  inputMode="numeric"
                  value={form.latencyMs}
                  onChange={(latencyMs) => set({ latencyMs })}
                />
              </div>
              <div className="outbound-field">
                <Input
                  label="Retry-After (s)"
                  inputMode="numeric"
                  value={form.retryAfter}
                  onChange={(retryAfter) => set({ retryAfter })}
                />
              </div>
              <div className="outbound-field">
                <Input
                  label="Times"
                  hint="Empty keeps it until cleared."
                  inputMode="numeric"
                  value={form.times}
                  onChange={(times) => set({ times })}
                />
              </div>
            </Inline>
            <Checkbox
              label="Drop the connection"
              description="Close it without answering."
              checked={form.drop}
              onChange={(drop) => set({ drop })}
            />
            {refusal ? <SimRefusal message={refusal} /> : null}
            <Inline gap={3}>
              <Button
                variant="primary"
                onClick={() => void run({ action: () => addFault({ fault: faultOf({ form }) }) })}
              >
                Add fault
              </Button>
            </Inline>
          </Stack>
        </Panel>
        {faults.error ? (
          <SimRefusal message={faults.error.message} />
        ) : (
          <Panel title="Active faults" meta={String(items.length)}>
            <Table
              caption="Faults, first match wins"
              rows={items}
              rowKey={(fault) => fault.id}
              empty="No faults. Every call is answered as the real service would."
              columns={[
                { key: "channel", header: "Channel", cell: (fault) => channelLabel[fault.channel] },
                { key: "target", header: "Target", cell: (fault) => fault.target, mono: true },
                {
                  key: "answer",
                  header: "Answer",
                  cell: (fault) => <Badge tone="warn">{answerOf({ fault })}</Badge>,
                },
                {
                  key: "latency",
                  header: "Latency",
                  cell: (fault) => `${fault.latencyMs} ms`,
                  mono: true,
                },
                {
                  key: "times",
                  header: "Times left",
                  cell: (fault) =>
                    fault.times === undefined ? "until cleared" : String(fault.times),
                },
                {
                  key: "remove",
                  header: "",
                  width: "104px",
                  cell: (fault) => (
                    <Button
                      size="sm"
                      variant="ghost"
                      title={`Remove fault ${fault.id}`}
                      onClick={() => void run({ action: () => removeFault({ id: fault.id }) })}
                    >
                      Remove
                    </Button>
                  ),
                },
              ]}
            />
          </Panel>
        )}
      </Stack>
    </Section>
  );
};
