import {
  Button,
  ConfirmButton,
  consoleLinks,
  EmptyState,
  IconButton,
  IconRefresh,
  Inline,
  Input,
  Page,
  Panel,
  Select,
  Stack,
  StatusDot,
  Text,
  TopBar,
  useToast,
} from "@langwatch/design-system-internal";
import { useCallback, useEffect, useMemo, useState } from "react";

import { InboxDetails } from "./inbox-details.tsx";
import { filterMessages, recipientCounts } from "./inbox-filter.ts";
import { mailApi, type Inbox as InboxInfo, type Message } from "./mail-api.ts";
import { MessageList } from "./message-list.tsx";
import { ReadingPane } from "./reading-pane.tsx";
import { useOpenMessage } from "./route.ts";
import { useLiveInbox, type Connection } from "./use-live-inbox.ts";
import { useNotify } from "./use-notify.ts";

type Opened =
  | { state: "none" }
  | { state: "loading"; id: string }
  | { state: "missing"; id: string }
  | { state: "open"; message: Message };

const CONNECTION_LABEL: Record<Connection, string> = {
  starting: "Connecting",
  live: "Live",
  down: "Disconnected, retrying",
};

const CONNECTION_DOT = { starting: "starting", live: "live", down: "down" } as const;

const describeError = ({ error }: { error: unknown }) =>
  error instanceof Error ? error.message : String(error);

/** Loads the open message whenever the address bar names a different one. */
const useOpened = ({ openId }: { openId: string }) => {
  const [opened, setOpened] = useState<Opened>({ state: "none" });
  useEffect(() => {
    if (openId === "") {
      setOpened({ state: "none" });
      return;
    }
    let current = true;
    setOpened({ state: "loading", id: openId });
    mailApi
      .get({ id: openId })
      .then((message) => {
        if (!current) return;
        setOpened(message ? { state: "open", message } : { state: "missing", id: openId });
      })
      .catch(() => {
        if (current) setOpened({ state: "missing", id: openId });
      });
    return () => {
      current = false;
    };
  }, [openId]);
  return opened;
};

const OpenedPane = ({
  opened,
  onDelete,
  deleting,
}: {
  opened: Opened;
  onDelete: (input: { id: string }) => void;
  deleting: boolean;
}) => {
  switch (opened.state) {
    case "none":
      return (
        <Panel>
          <EmptyState
            title="Select a message"
            description="Its preview, plain text, headers and links open here."
          />
        </Panel>
      );
    case "loading":
      return (
        <Panel>
          <EmptyState title="Opening message" />
        </Panel>
      );
    case "missing":
      return (
        <Panel>
          <EmptyState
            title="This message is not in the inbox"
            description="It was deleted, or the inbox was cleared."
          />
        </Panel>
      );
    case "open":
      return (
        <ReadingPane
          key={opened.message.id}
          message={opened.message}
          onDelete={onDelete}
          deleting={deleting}
        />
      );
  }
};

export const Inbox = () => {
  const toast = useToast();
  const { openId, open } = useOpenMessage();
  const notify = useNotify({ onOpen: open });
  const { messages, connection, error, refresh } = useLiveInbox({ onList: notify.announce });
  const opened = useOpened({ openId });
  const [info, setInfo] = useState<InboxInfo | undefined>(undefined);
  const [query, setQuery] = useState("");
  const [recipient, setRecipient] = useState("");
  const [busy, setBusy] = useState(false);
  const chrome = useMemo(() => consoleLinks({ location: window.location }), []);

  useEffect(() => {
    mailApi
      .inbox()
      .then(setInfo)
      .catch(() => setInfo(undefined));
  }, []);

  const all = messages ?? [];
  const shown = filterMessages({ messages: all, query, recipient });
  const recipients = recipientCounts({ messages: all });

  const clearAll = useCallback(async () => {
    setBusy(true);
    try {
      await mailApi.clear();
      open({ id: "" });
      toast.show({ title: "Inbox cleared.", tone: "ok" });
      await refresh();
    } catch (caught) {
      toast.show({ title: describeError({ error: caught }), tone: "error" });
    } finally {
      setBusy(false);
    }
  }, [open, refresh, toast]);

  const deleteOne = useCallback(
    async ({ id }: { id: string }) => {
      setBusy(true);
      try {
        await mailApi.remove({ id });
        open({ id: "" });
        toast.show({ title: "Message deleted.", tone: "ok" });
        await refresh();
      } catch (caught) {
        toast.show({ title: describeError({ error: caught }), tone: "error" });
      } finally {
        setBusy(false);
      }
    },
    [open, refresh, toast],
  );

  const toggleNotify = useCallback(async () => {
    toast.show({ title: await notify.toggle() });
  }, [notify, toast]);

  return (
    <Page
      nav={
        <TopBar
          name="Mail"
          slug={info?.stack || chrome.slug}
          homeHref={chrome.homeHref}
          links={chrome.links}
        />
      }
      title="Inbox"
      subtitle="Every email this stack sends lands here and is never relayed to its recipients."
      actions={
        <>
          <Button
            onClick={() => void toggleNotify()}
            pressed={notify.on}
            disabled={!notify.supported}
            title={
              notify.supported
                ? "Show a desktop notification when a message arrives, even when this tab is in the background"
                : "This browser does not offer desktop notifications."
            }
          >
            Notify me
          </Button>
          <ConfirmButton
            label="Clear inbox"
            confirmLabel="Clear all"
            disabled={all.length === 0 || busy}
            onConfirm={() => void clearAll()}
          />
        </>
      }
    >
      <Stack gap={4}>
        <Inline gap={3} wrap>
          <div className="mail-search">
            <Input
              label="Search inbox"
              hideLabel
              type="search"
              placeholder="Subject, recipient or sender"
              autoComplete="off"
              value={query}
              onChange={setQuery}
            />
          </div>
          <div className="mail-recipient">
            <Select
              label="Recipient"
              hideLabel
              value={recipient}
              onChange={setRecipient}
              options={[
                { value: "", label: `All recipients (${recipients.length})` },
                ...recipients.map(({ address, count }) => ({
                  value: address,
                  label: `${address} (${count})`,
                })),
              ]}
            />
          </div>
          <span className="mail-status" title={error}>
            <StatusDot state={CONNECTION_DOT[connection]} label={CONNECTION_LABEL[connection]} />
          </span>
        </Inline>
        <div className="mail-layout">
          <MessageList
            messages={shown}
            total={all.length}
            filtered={query.trim() !== "" || recipient !== ""}
            openId={openId}
            onOpen={open}
            actions={
              <IconButton
                label="Refresh"
                icon={<IconRefresh />}
                size="sm"
                onClick={() => void refresh()}
              />
            }
          />
          <OpenedPane opened={opened} onDelete={(input) => void deleteOne(input)} deleting={busy} />
        </div>
        {info !== undefined && <InboxDetails inbox={info} />}
        <Text size="sm" tone="muted">
          Captured locally. Messages are never relayed to their recipients.
        </Text>
      </Stack>
    </Page>
  );
};
