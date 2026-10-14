import {
  Button,
  CodeBlock,
  ConfirmButton,
  CopyButton,
  EmptyState,
  KeyValue,
  Link,
  List,
  ListItem,
  Panel,
  Stack,
  Tabs,
  type TabItem,
} from "@langwatch/design-system-internal";
import { useState } from "react";

import { linkify } from "./linkify.ts";
import { mailApi, type Message } from "./mail-api.ts";

const received = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "medium" });
const bytes = new Intl.NumberFormat();

type View = "preview" | "text" | "source" | "headers";

const tabsFor = ({ message }: { message: Message }): TabItem[] => [
  ...(message.html === "" ? [] : [{ id: "preview", label: "Preview" }]),
  { id: "text", label: "Plain text" },
  ...(message.html === "" ? [] : [{ id: "source", label: "HTML source" }]),
  { id: "headers", label: "Headers", count: Object.keys(message.headers).length },
];

const isView = (id: string): id is View =>
  id === "preview" || id === "text" || id === "source" || id === "headers";

const PlainText = ({ text }: { text: string }) =>
  text === "" ? (
    <EmptyState title="No plain-text body" description="This message was sent as HTML only." />
  ) : (
    <pre className="mail-text">
      {linkify({ text }).map((part, index) =>
        part.kind === "link" ? (
          <Link key={index} href={part.value} external mono>
            {part.value}
          </Link>
        ) : (
          part.value
        ),
      )}
    </pre>
  );

const MessageBody = ({ message, view }: { message: Message; view: View }) => {
  switch (view) {
    case "preview":
      return (
        <Panel flush>
          <iframe
            className="mail-preview"
            data-theme="light"
            title="Email preview"
            sandbox="allow-popups allow-popups-to-escape-sandbox"
            src={mailApi.htmlPath({ id: message.id })}
          />
        </Panel>
      );
    case "text":
      return (
        <Panel>
          <PlainText text={message.text} />
        </Panel>
      );
    case "source":
      return (
        <Panel>
          <CodeBlock code={message.html} label="HTML source" wrap />
        </Panel>
      );
    case "headers":
      return (
        <Panel>
          <KeyValue
            items={Object.entries(message.headers)
              .toSorted(([a], [b]) => a.localeCompare(b))
              .map(([label, value]) => ({ label, value }))}
          />
        </Panel>
      );
  }
};

export type ReadingPaneProps = {
  message: Message;
  onDelete: (input: { id: string }) => void;
  deleting: boolean;
};

export const ReadingPane = ({ message, onDelete, deleting }: ReadingPaneProps) => {
  const tabs = tabsFor({ message });
  const [view, setView] = useState<View>(message.html === "" ? "text" : "preview");
  return (
    <Stack gap={4}>
      <Panel
        title={message.subject || "(no subject)"}
        actions={
          <>
            <Button size="sm" href={mailApi.jsonPath({ id: message.id })}>
              View JSON
            </Button>
            <ConfirmButton
              size="sm"
              label="Delete"
              confirmLabel="Delete it"
              disabled={deleting}
              onConfirm={() => onDelete({ id: message.id })}
            />
          </>
        }
      >
        <KeyValue
          items={[
            { label: "From", value: message.from },
            { label: "To", value: message.to.join(", ") },
            {
              label: "Received",
              value: received.format(message.receivedAt),
              mono: false,
              copy: false,
            },
            {
              label: "Size",
              value: `${bytes.format(message.sizeBytes)} bytes`,
              mono: false,
              copy: false,
            },
          ]}
        />
      </Panel>
      <Tabs
        label="Message format"
        tabs={tabs}
        value={view}
        onChange={(id) => {
          if (isView(id)) setView(id);
        }}
      />
      <div role="tabpanel" aria-label={tabs.find((tab) => tab.id === view)?.label}>
        <MessageBody message={message} view={view} />
      </div>
      {message.links.length > 0 && (
        <Panel title="Links in this email" meta={String(message.links.length)}>
          <List>
            {message.links.map((link) => (
              <ListItem
                key={link}
                title={
                  <Link href={link} external mono>
                    {link}
                  </Link>
                }
                actions={<CopyButton value={link} label="Copy link" />}
              />
            ))}
          </List>
        </Panel>
      )}
      {message.attachments.length > 0 && (
        <Panel title="Attachments" meta="Metadata only">
          <List>
            {message.attachments.map((attachment, index) => (
              <ListItem
                key={`${attachment.filename}-${index}`}
                title={attachment.filename || "(unnamed)"}
                description={attachment.contentType}
                meta={`${bytes.format(attachment.sizeBytes)} bytes`}
              />
            ))}
          </List>
        </Panel>
      )}
    </Stack>
  );
};
