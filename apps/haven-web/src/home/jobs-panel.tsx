import { Badge, Panel, Table, Text, type TableColumn } from "@langwatch/design-system-internal";

import { jobRunSchema, type JobRun } from "../shared/contract.ts";
import { formatAge, formatDuration } from "../shared/format.ts";
import { useCliRows } from "../shared/use-cli-rows.ts";

const NS_PER_SECOND = 1e9;

const columnsAt = ({ now }: { now: number }): TableColumn<JobRun>[] => [
  { key: "name", header: "Job", mono: true, cell: (run) => run.name },
  {
    key: "exit",
    header: "Result",
    width: "96px",
    cell: (run) =>
      run.exit === 0 ? <Badge tone="ok">ok</Badge> : <Badge tone="error">exit {run.exit}</Badge>,
  },
  {
    key: "duration",
    header: "Took",
    width: "96px",
    align: "end",
    cell: (run) => formatDuration({ seconds: run.duration / NS_PER_SECOND }),
  },
  {
    key: "time",
    header: "When",
    width: "120px",
    muted: true,
    hideOnNarrow: true,
    cell: (run) => formatAge({ at: run.time, now }),
  },
];

/** `haven status`'s jobs section: the one-shot lanes the last up ran. */
export const JobsPanel = ({ slug, now }: { slug: string; now: number }) => {
  const jobs = useCliRows({ slug, name: "jobs", row: jobRunSchema });
  return (
    <Panel title="Jobs" meta={jobs.data === undefined ? undefined : `${jobs.data.length}`}>
      {jobs.error !== undefined && jobs.data === undefined ? (
        <Text tone="muted">{jobs.error}</Text>
      ) : (
        <Table
          columns={columnsAt({ now })}
          rows={jobs.data ?? []}
          rowKey={(run) => `${run.name}:${run.time}`}
          caption="Jobs of the last up"
          empty="No jobs recorded yet"
        />
      )}
    </Panel>
  );
};
