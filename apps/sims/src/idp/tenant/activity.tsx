import {
  Badge,
  Button,
  Inline,
  Input,
  Panel,
  Section,
  Select,
  Stack,
  Table,
  Text,
  type TableColumn,
} from "@langwatch/design-system-internal";
import { useEffect, useMemo, useState } from "react";

import { activitySchema, request, type ActivityEvent } from "../api.ts";
import { msOf, nowMs } from "../clock.ts";

export const ACTIVITY_POLL_MS = 2_000;

const CLOCK = new Intl.DateTimeFormat(undefined, { timeStyle: "medium" });

type Outcome = "" | "ok" | "refused";

const OUTCOMES: { value: Outcome; label: string }[] = [
  { value: "", label: "All outcomes" },
  { value: "ok", label: "Successful" },
  { value: "refused", label: "Refused" },
];

const isOutcome = (value: string): value is Outcome =>
  OUTCOMES.some((option) => option.value === value);

const detailOf = ({ event }: { event: ActivityEvent }) => {
  const who = event.subject || event.client;
  return who ? `${event.detail} · ${who}` : event.detail;
};

const columns: TableColumn<ActivityEvent>[] = [
  {
    key: "at",
    header: "Time",
    cell: (event) => CLOCK.format(msOf({ iso: event.at })),
    mono: true,
    width: "128px",
    hideOnNarrow: true,
  },
  {
    key: "outcome",
    header: "Outcome",
    cell: (event) =>
      event.outcome === "ok" ? (
        <Badge tone="ok">ok</Badge>
      ) : (
        <Badge tone="error">{event.outcome}</Badge>
      ),
    width: "104px",
  },
  {
    key: "kind",
    header: "Event",
    cell: (event) => event.kind,
    mono: true,
    width: "22%",
    hideOnNarrow: true,
  },
  { key: "detail", header: "Detail", cell: (event) => detailOf({ event }) },
];

/** Events whose kind, detail, subject or client contains what was typed. */
export const filterActivity = ({
  events,
  needle,
  outcome,
}: {
  events: ActivityEvent[];
  needle: string;
  outcome: Outcome;
}) => {
  const wanted = needle.trim().toLowerCase();
  return events.filter(
    (event) =>
      (outcome === "" || event.outcome === outcome) &&
      [event.kind, event.detail, event.subject ?? "", event.client ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(wanted),
  );
};

/** The tenant's recent history, re-read every two seconds while the page is visible. */
const useActivity = ({ tenantId, paused }: { tenantId: number; paused: boolean }) => {
  const [events, setEvents] = useState<ActivityEvent[] | undefined>(undefined);
  const [status, setStatus] = useState("Connecting…");
  useEffect(() => {
    if (paused) return;
    let controller: AbortController | undefined;
    const poll = async () => {
      if (document.hidden || controller !== undefined) return;
      const current = new AbortController();
      controller = current;
      const answer = await request({
        path: `/control/t/${tenantId}/activity`,
        schema: activitySchema,
        signal: current.signal,
      });
      if (current.signal.aborted) return;
      controller = undefined;
      if (answer.ok) {
        setEvents(answer.data.events);
        setStatus(`updated ${CLOCK.format(nowMs())}`);
      } else {
        setStatus(`Activity unavailable (${answer.refusal.title}). Retrying…`);
      }
    };
    const onVisible = () => void poll();
    onVisible();
    const timer = window.setInterval(onVisible, ACTIVITY_POLL_MS);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      controller?.abort();
    };
  }, [tenantId, paused]);
  return { events, status };
};

/** What the empty table says: still loading, nothing yet, or nothing matching. */
const emptyActivity = ({ events }: { events: ActivityEvent[] | undefined }) => {
  if (events === undefined) return "Loading…";
  if (events.length === 0)
    return "No activity yet. Start a login from your app to see the requests here.";
  return "No events match these filters.";
};

export const ActivityTab = ({ tenantId }: { tenantId: number }) => {
  const [paused, setPaused] = useState(false);
  const [needle, setNeedle] = useState("");
  const [outcome, setOutcome] = useState<Outcome>("");
  const { events, status } = useActivity({ tenantId, paused });
  const visible = useMemo(
    () => filterActivity({ events: events ?? [], needle, outcome }),
    [events, needle, outcome],
  );
  const emptyText = emptyActivity({ events });

  return (
    <Section
      title="Activity"
      description="Every request this tenant serves or refuses, newest first."
    >
      <Stack gap={4}>
        <Inline gap={3} wrap align="end">
          <div className="idp-grow">
            <Input
              label="Filter activity"
              hideLabel
              type="search"
              placeholder="Protocol, user or reason"
              value={needle}
              onChange={setNeedle}
            />
          </div>
          <Select
            label="Outcome"
            hideLabel
            options={OUTCOMES}
            value={outcome}
            onChange={(value) => {
              if (isOutcome(value)) setOutcome(value);
            }}
          />
          <Button onClick={() => setPaused((value) => !value)}>
            {paused ? "Resume" : "Pause"}
          </Button>
        </Inline>
        <output className="idp-status">
          <Text tone="muted" size="sm">
            {`${paused ? "Paused" : "Live"} · ${visible.length} events · ${status}`}
          </Text>
        </output>
        <Panel>
          <Table
            columns={columns}
            rows={visible}
            rowKey={(event) => `${event.at}|${event.kind}|${event.detail}`}
            caption="Tenant activity"
            empty={emptyText}
          />
        </Panel>
      </Stack>
    </Section>
  );
};
