import {
  Button,
  Checkbox,
  CopyButton,
  Inline,
  Input,
  LogView,
  Page,
  Select,
  Spacer,
  Stack,
  type LogLine,
} from "@langwatch/design-system-internal";
import { useEffect, useState, type KeyboardEvent } from "react";

import { getJson } from "../shared/api.ts";
import { logsSchema, type CapturedLine, type Logs } from "../shared/contract.ts";
import { formatClock, formatCount } from "../shared/format.ts";
import { HavenTopBar } from "../shared/haven-top-bar.tsx";
import { usePoll } from "../shared/use-poll.ts";
import { kitLevelOf, severityCounts, severityOf } from "./severity.ts";

/** The filter's id: `/` focuses it from anywhere on the hub. */
export const LOG_FILTER_ID = "haven-log-filter";
const POLL_MS = 2000;
const SERVICE_WIDTH = 12;

export type LogsPageProps = {
  stacks: string[];
  stack: string;
  lane: string;
  onSelect: (selection: { stack: string; lane: string }) => void;
  /** Bumped by the `/` shortcut; each bump focuses the filter. */
  focusRequest: number;
};

const optionsOf = ({
  names,
  current,
  none,
}: {
  names: string[];
  current: string;
  none: string;
}) => {
  const all = current === "" || names.includes(current) ? names : [...names, current];
  return [{ value: "", label: none }, ...all.map((name) => ({ value: name, label: name }))];
};

const lineText = ({ line }: { line: CapturedLine }) => `${line.at} [${line.service}] ${line.text}`;

const download = ({ text, name }: { text: string; name: string }) => {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const statusOf = ({
  logs,
  shown,
  filtered,
  muted,
  paused,
  updatedAt,
}: {
  logs: Logs | undefined;
  shown: number;
  filtered: boolean;
  muted: string[];
  paused: boolean;
  updatedAt: number | undefined;
}) => {
  const total = logs?.lines.length ?? 0;
  return [
    paused ? "Paused" : "Live",
    filtered
      ? `${formatCount({ count: shown })} of ${formatCount({ count: total })} lines shown`
      : `${formatCount({ count: total })} lines`,
    muted.length > 0 ? `hiding ${muted.join(", ")}` : "",
    updatedAt === undefined ? "" : `updated ${formatClock({ at: updatedAt })}`,
    logs === undefined ? "" : `latest ${formatCount({ count: logs.limit })} lines kept`,
  ]
    .filter((part) => part.length > 0)
    .join(" · ");
};

export const LogsPage = ({ stacks, stack, lane, onSelect, focusRequest }: LogsPageProps) => {
  const [search, setSearch] = useState("");
  const [muted, setMuted] = useState<string[]>([]);
  const [paused, setPaused] = useState(false);
  const poll = usePoll({
    key: `${stack}/${lane}`,
    paused: paused || stack === "",
    intervalMs: POLL_MS,
    load: ({ signal }) =>
      getJson({
        path: `/api/logs?${new URLSearchParams({ stack, service: lane }).toString()}`,
        schema: logsSchema,
        signal,
      }),
  });

  useEffect(() => {
    if (focusRequest > 0) document.getElementById(LOG_FILTER_ID)?.focus();
  }, [focusRequest]);

  const lines = poll.data?.lines ?? [];
  const needle = search.toLowerCase();
  const visible = lines.filter(
    (line) =>
      !muted.includes(severityOf({ line })) &&
      `${line.service} ${line.text}`.toLowerCase().includes(needle),
  );
  const viewLines: LogLine[] = visible.map((line, index) => ({
    id: `${line.at}:${index}`,
    time: formatClock({ at: line.at }),
    level: kitLevelOf({ line }),
    text: lane === "" ? `${line.service.padEnd(SERVICE_WIDTH)} ${line.text}` : line.text,
  }));
  const counts = severityCounts({ lines });
  const status =
    poll.error === undefined
      ? statusOf({
          logs: poll.data,
          shown: visible.length,
          filtered: needle.length > 0 || muted.length > 0,
          muted,
          paused,
          updatedAt: poll.updatedAt,
        })
      : `Could not refresh logs. ${poll.error} Retrying…`;
  const copyText = visible.map((line) => lineText({ line })).join("\n");

  const toggle = ({ severity, shown }: { severity: string; shown: boolean }) =>
    setMuted((previous) =>
      shown ? previous.filter((name) => name !== severity) : [...previous, severity],
    );
  const onFilterKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Escape") return;
    if (search === "") event.currentTarget.blur();
    else setSearch("");
  };

  let empty = "Choose a stack to read its captured output.";
  if (stack !== "") {
    empty =
      lines.length > 0
        ? "No lines match these filters."
        : "No captured output yet. Logs appear when a service writes output.";
  }

  return (
    <Page
      width="full"
      nav={<HavenTopBar current="logs" hubHref="/" />}
      title="Logs"
      subtitle={stack === "" ? "Captured output of every stack on this machine." : status}
    >
      <Stack gap={3}>
        <Inline gap={2} wrap>
          <Select
            label="Stack"
            hideLabel
            value={stack}
            options={optionsOf({ names: stacks, current: stack, none: "Choose a stack" })}
            onChange={(next) => onSelect({ stack: next, lane: "" })}
          />
          <Select
            label="Service"
            hideLabel
            value={lane}
            disabled={stack === ""}
            options={optionsOf({
              names: poll.data?.services ?? [],
              current: lane,
              none: "All services",
            })}
            onChange={(next) => onSelect({ stack, lane: next })}
          />
          <Input
            label="Filter"
            hideLabel
            id={LOG_FILTER_ID}
            type="search"
            placeholder="Filter lines (press /)"
            value={search}
            onChange={setSearch}
            onKeyDown={onFilterKey}
          />
          <Spacer />
          <Button onClick={() => setPaused((previous) => !previous)} disabled={stack === ""}>
            {paused ? "Resume" : "Pause"}
          </Button>
          <CopyButton value={copyText} label="Copy visible" size="md" showLabel />
          <Button
            disabled={visible.length === 0}
            onClick={() => download({ text: copyText, name: `${stack || "haven"}.log` })}
          >
            Download
          </Button>
        </Inline>
        {counts.length > 0 && (
          <fieldset className="haven-severity">
            <legend className="ds-visually-hidden">Severity</legend>
            <Inline gap={4} wrap>
              {counts.map(([severity, count]) => (
                <Checkbox
                  key={severity}
                  label={`${severity} ${formatCount({ count })}`}
                  checked={!muted.includes(severity)}
                  onChange={(shown) => toggle({ severity, shown })}
                />
              ))}
            </Inline>
          </fieldset>
        )}
        <LogView
          lines={viewLines}
          label="Captured service logs"
          height="lg"
          empty={empty}
          highlight={search}
        />
      </Stack>
    </Page>
  );
};
