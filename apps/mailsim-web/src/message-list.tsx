import { EmptyState, List, ListItem, Panel } from "@langwatch/design-system-internal";
import { useEffect, type ReactNode } from "react";

import type { Summary } from "./mail-api.ts";
import { messageHref } from "./route.ts";

const time = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

const LIST_LABEL = "Caught messages";

/** A plain left click opens in place; a modified click keeps the link's own behaviour. */
const isPlainClick = ({ event }: { event: MouseEvent }) =>
  event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;

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
  // ListItem takes no click handler, so a row's link is caught here, by its list.
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || !isPlainClick({ event })) return;
      const row = event.target.closest(`[aria-label="${LIST_LABEL}"] a`);
      const id = row?.querySelector<HTMLElement>("[data-message]")?.dataset.message;
      if (id === undefined) return;
      event.preventDefault();
      onOpen({ id });
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [onOpen]);
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
        <List label={LIST_LABEL}>
          {messages.map((message) => (
            <ListItem
              key={message.id}
              href={messageHref({ id: message.id })}
              title={
                <span data-message={message.id} data-open={message.id === openId || undefined}>
                  {message.subject || "(no subject)"}
                </span>
              }
              description={`${message.from} to ${message.to.join(", ")}`}
              meta={time.format(message.receivedAt)}
            />
          ))}
        </List>
      )}
    </Panel>
  );
};
