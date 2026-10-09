import { Badge, CopyButton, Panel, Section, Stack, Table } from "@langwatch/design-system-internal";
import { SimEmpty, SimRefusal, useSimPoll } from "@langwatch/sim-console";

import { channelLabel, fetchSetup } from "./outbound-api.ts";

/** The URLs to paste into the product, one per Slack webhook, receiver and queue. */
export const SetupView = () => {
  const setup = useSimPoll({ fetch: fetchSetup });
  const urls = setup.data ?? [];

  return (
    <Section
      title="Setup"
      description="Point the product at these URLs, or start the stack with haven up +outbound and the Slack settings are filled in for you."
    >
      <Stack gap={4}>
        {setup.error ? (
          <SimRefusal message={setup.error.message} />
        ) : (
          <Panel title="URLs" meta={String(urls.length)}>
            <Table
              caption="Where to send each kind of call"
              rows={urls}
              rowKey={(entry) => `${entry.channel}:${entry.url}`}
              empty={
                <SimEmpty title="Nothing to paste yet" hint="The sim has not reported its URLs." />
              }
              columns={[
                { key: "label", header: "For", cell: (entry) => entry.label },
                {
                  key: "channel",
                  header: "Channel",
                  cell: (entry) => <Badge>{channelLabel[entry.channel]}</Badge>,
                  width: "148px",
                },
                { key: "url", header: "URL", cell: (entry) => entry.url, mono: true },
                {
                  key: "setting",
                  header: "Setting",
                  cell: (entry) => entry.setting ?? "",
                  mono: true,
                  hideOnNarrow: true,
                },
                {
                  key: "copy",
                  header: "",
                  width: "56px",
                  cell: (entry) => <CopyButton value={entry.url} label={`Copy ${entry.label}`} />,
                },
              ]}
            />
          </Panel>
        )}
      </Stack>
    </Section>
  );
};
