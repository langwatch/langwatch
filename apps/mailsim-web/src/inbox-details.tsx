import { KeyValue, Panel } from "@langwatch/design-system-internal";

import type { Inbox } from "./mail-api.ts";

const EXAMPLE_ADDRESS = "alex+invite@example.test";

/** Which stack this inbox is, where to send mail, and whether it survives a restart. */
export const InboxDetails = ({ inbox }: { inbox: Inbox }) => (
  <Panel title="This inbox" meta="Any address is caught; nothing is relayed">
    <KeyValue
      items={[
        { label: "Stack", value: inbox.stack === "" ? "Standalone MailSim" : inbox.stack },
        { label: "SMTP listener", value: inbox.smtpAddr },
        { label: "Inbox", value: inbox.baseUrl },
        { label: "Try an address", value: EXAMPLE_ADDRESS },
        {
          label: "Storage",
          mono: false,
          copy: false,
          value: inbox.persistent
            ? "Captured messages survive service restarts."
            : "In memory: this inbox clears when MailSim restarts.",
        },
      ]}
    />
  </Panel>
);
