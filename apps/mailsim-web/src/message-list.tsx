import { EmptyState, List, ListItem, Panel } from "@langwatch/design-system-internal";
import type { ReactNode } from "react";

import type { Summary } from "./mail-api.ts";
import { messageHref } from "./route.ts";

const time = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

export type MessageListProps = {
  messages: Summary[];
  total: number;
  filtered: boolean;
  openId: string;
  onOpen: (input: { id: string }) => void;
  actions?: ReactNode;
};

export const MessageList = ({
  messages,
  total,
  filtered,
  openId,
  onOpen,
  actions,
}: MessageListProps) => {
  const meta = filtered ? `${messages.length} of ${total}` : String(total);
  return (
    <Panel title="Messages" meta={meta} actions={actions}>
      {messages.length === 0 ? (
        <EmptyState
          title={filtered ? "No messages match" : "No messages yet"}
          description={
            filtered
              ? "Try another search or recipient."
              : "Trigger an invite or sign-in email in your app and it appears here."
          }
        />
      ) : (
        <List label="Caught messages">
          {messages.map((message) => (
            <ListItem
              key={message.id}
              href={messageHref({ id: message.id })}
              onSelect={() => onOpen({ id: message.id })}
              current={message.id === openId}
              title={message.subject || "(no subject)"}
              description={`${message.from} to ${message.to.join(", ")}`}
              meta={time.format(message.receivedAt)}
            />
          ))}
        </List>
      )}
    </Panel>
  );
};
