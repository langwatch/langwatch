import {
  Badge,
  Callout,
  Grid,
  KeyValue,
  Panel,
  Stack,
  Table,
  Tabs,
  type TableColumn,
} from "@langwatch/design-system-internal";

import {
  rootSpanSchema,
  serviceProfileSchema,
  seriesSchema,
  type ProfileEntry,
  type RootSpan,
} from "../../shared/contract.ts";
import { formatAge } from "../../shared/format.ts";
import { useCliRows } from "../../shared/use-cli-rows.ts";

const SUBS = [
  { id: "", label: "Traces" },
  { id: "metrics", label: "Metrics" },
  { id: "profiles", label: "Profiles" },
];
const NS_PER_MS = 1e6;

const Unread = ({ what, error }: { what: string; error: string }) => (
  <Callout tone="error" title={`The ${what} could not be read`}>
    {error}
  </Callout>
);

const traceColumnsAt = ({ now }: { now: number }): TableColumn<RootSpan>[] => [
  {
    key: "time",
    header: "When",
    width: "104px",
    muted: true,
    cell: (span) => formatAge({ at: span.time, now }),
  },
  { key: "service", header: "Service", width: "120px", mono: true, cell: (span) => span.service },
  { key: "name", header: "Root span", mono: true, cell: (span) => span.name },
  {
    key: "duration",
    header: "Took",
    width: "96px",
    align: "end",
    cell: (span) => `${Math.round(span.duration / NS_PER_MS)}ms`,
  },
  {
    key: "error",
    header: "",
    width: "80px",
    cell: (span) => span.error && <Badge tone="error">error</Badge>,
  },
];

/** `haven obs traces`: this stack's recent root spans, newest first. */
const TracesPanel = ({ slug, now }: { slug: string; now: number }) => {
  const traces = useCliRows({ slug, name: "traces", row: rootSpanSchema });
  if (traces.error !== undefined && traces.data === undefined) {
    return <Unread what="traces" error={traces.error} />;
  }
  return (
    <Panel title="Traces">
      <Table
        columns={traceColumnsAt({ now })}
        rows={traces.data ?? []}
        rowKey={(span) => span.traceId}
        caption="Recent root spans of this stack"
        empty="No traces in the last ten minutes"
        maxHeight="lg"
      />
    </Panel>
  );
};

/** `haven obs metrics`: rate, latency, queue depth and footprint now. */
const MetricsPanel = ({ slug }: { slug: string }) => {
  const metrics = useCliRows({ slug, name: "metrics", row: seriesSchema });
  if (metrics.error !== undefined && metrics.data === undefined) {
    return <Unread what="metrics" error={metrics.error} />;
  }
  const items = (metrics.data ?? []).map((series) => ({
    label: series.label,
    value: series.value,
    copy: false,
  }));
  return (
    <Panel title="Metrics" meta="last ten minutes">
      <KeyValue items={items} />
    </Panel>
  );
};

const shareItems = ({ entries }: { entries: ProfileEntry[] | null }) =>
  (entries ?? []).map((entry) => ({
    label: `${Math.round(entry.share * 100)}%`,
    value: entry.function,
    copy: false,
  }));

/** `haven obs profiles`: each service's hottest functions by CPU and by heap. */
const ProfilesPanel = ({ slug }: { slug: string }) => {
  const profiles = useCliRows({ slug, name: "profiles", row: serviceProfileSchema });
  if (profiles.error !== undefined && profiles.data === undefined) {
    return <Unread what="profiles" error={profiles.error} />;
  }
  return (
    <Stack gap={4}>
      {(profiles.data ?? []).map((profile) => (
        <Grid key={profile.service} columns={2}>
          <Panel title={`${profile.service} CPU`}>
            <KeyValue items={shareItems({ entries: profile.cpu })} />
          </Panel>
          <Panel title={`${profile.service} heap`}>
            <KeyValue items={shareItems({ entries: profile.heap })} />
          </Panel>
        </Grid>
      ))}
    </Stack>
  );
};

/** The Obs tab: `haven obs traces|metrics|profiles` for this stack. */
export const ObsTab = ({
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
      <Tabs label="Observability" tabs={SUBS} value={current} onChange={onSub} />
      {current === "" && <TracesPanel slug={slug} now={now} />}
      {current === "metrics" && <MetricsPanel slug={slug} />}
      {current === "profiles" && <ProfilesPanel slug={slug} />}
    </Stack>
  );
};
