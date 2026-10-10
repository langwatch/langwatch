import {
  Badge,
  Button,
  Callout,
  LogView,
  Panel,
  Stack,
  Table,
  Tabs,
  type LogLine,
  type TableColumn,
} from "@langwatch/design-system-internal";

import { resolveFeedbackPath } from "../../shared/api.ts";
import {
  consoleEntrySchema,
  feedbackSchema,
  pageRequestSchema,
  type Feedback,
  type PageRequest,
} from "../../shared/contract.ts";
import { formatAge } from "../../shared/format.ts";
import { useCliRows } from "../../shared/use-cli-rows.ts";
import { useLifecycle } from "../../shared/use-lifecycle.ts";

const SUBS = [
  { id: "", label: "Feedback" },
  { id: "console", label: "Console" },
  { id: "network", label: "Network" },
];

const kitLevel = ({ level }: { level: string }): LogLine["level"] => {
  if (level === "error") return "error";
  if (level === "warn") return "warn";
  return "info";
};

const requestColumns: TableColumn<PageRequest>[] = [
  { key: "method", header: "Method", width: "80px", mono: true, cell: (req) => req.method },
  {
    key: "status",
    header: "Status",
    width: "80px",
    cell: (req) => <Badge tone={req.failed ? "error" : "ok"}>{req.status}</Badge>,
  },
  {
    key: "duration",
    header: "Took",
    width: "88px",
    align: "end",
    cell: (req) => `${Math.round(req.durationMs)}ms`,
  },
  { key: "url", header: "URL", mono: true, cell: (req) => req.url },
];

const Unread = ({ error }: { error: string }) => (
  <Callout tone="error" title="The orb store could not be read">
    {error}
  </Callout>
);

/** `haven orb console`: the app page's console as the orb last pushed it. */
const ConsolePanel = ({ slug }: { slug: string }) => {
  const entries = useCliRows({ slug, name: "console", row: consoleEntrySchema });
  if (entries.error !== undefined && entries.data === undefined) {
    return <Unread error={entries.error} />;
  }
  const lines = (entries.data ?? []).map((entry, index) => ({
    id: `${entry.at}:${index}`,
    time: entry.at,
    level: kitLevel(entry),
    text: entry.text,
  }));
  return (
    <LogView
      lines={lines}
      label="App page console"
      height="lg"
      empty="No console buffer yet: open the app on this stack with the orb showing."
    />
  );
};

/** `haven orb network`: the app page's requests as the orb last pushed them. */
const NetworkPanel = ({ slug }: { slug: string }) => {
  const requests = useCliRows({ slug, name: "network", row: pageRequestSchema });
  if (requests.error !== undefined && requests.data === undefined) {
    return <Unread error={requests.error} />;
  }
  return (
    <Panel title="Network">
      <Table
        columns={requestColumns}
        rows={requests.data ?? []}
        rowKey={(req) => `${req.at}:${req.method}:${req.url}`}
        caption="App page requests"
        empty="No network buffer yet: open the app on this stack with the orb showing."
        maxHeight="lg"
      />
    </Panel>
  );
};

/** `haven orb feedback list|resolve`: notes readers sent from the orb, newest first. */
const FeedbackPanel = ({ slug, now }: { slug: string; now: number }) => {
  const feedback = useCliRows({ slug, name: "feedback", row: feedbackSchema });
  const { busy, act } = useLifecycle({ refresh: feedback.refresh });
  if (feedback.error !== undefined && feedback.data === undefined) {
    return <Unread error={feedback.error} />;
  }
  const items = [...(feedback.data ?? [])].reverse();
  const columns: TableColumn<Feedback>[] = [
    {
      key: "state",
      header: "State",
      width: "96px",
      cell: (item) =>
        item.resolvedAt === undefined ? (
          <Badge tone="warn">open</Badge>
        ) : (
          <Badge tone="ok">resolved</Badge>
        ),
    },
    { key: "note", header: "Note", cell: (item) => item.note },
    {
      key: "route",
      header: "Page",
      mono: true,
      muted: true,
      hideOnNarrow: true,
      cell: (item) => item.route || item.url,
    },
    {
      key: "received",
      header: "Sent",
      width: "104px",
      muted: true,
      cell: (item) => formatAge({ at: item.receivedAt, now }),
    },
    {
      key: "resolve",
      header: "",
      width: "104px",
      align: "end",
      cell: (item) =>
        item.resolvedAt === undefined && (
          <Button
            size="sm"
            loading={busy === item.id}
            disabled={busy !== undefined}
            onClick={() =>
              void act({
                key: item.id,
                path: resolveFeedbackPath({ slug, id: item.id }),
                doing: `resolve ${item.id}`,
              })
            }
          >
            Resolve
          </Button>
        ),
    },
  ];
  return (
    <Panel
      title="Feedback"
      meta={`${items.filter((item) => item.resolvedAt === undefined).length} open`}
    >
      <Table
        columns={columns}
        rows={items}
        rowKey={(item) => item.id}
        caption="Feedback sent from the orb"
        empty="No feedback yet: the orb on this stack's app page sends it."
      />
    </Panel>
  );
};

/** The Orb tab: `haven orb feedback|console|network` for this stack. */
export const OrbTab = ({
  slug,
  sub,
  now,
  onSub,
}: {
  slug: string;
  sub: string;
  now: number;
  onSub: (sub: string) => void;
}) => {
  const current = SUBS.some((item) => item.id === sub) ? sub : "";
  return (
    <Stack gap={4}>
      <Tabs label="Orb" tabs={SUBS} value={current} onChange={onSub} />
      {current === "" && <FeedbackPanel slug={slug} now={now} />}
      {current === "console" && <ConsolePanel slug={slug} />}
      {current === "network" && <NetworkPanel slug={slug} />}
    </Stack>
  );
};
