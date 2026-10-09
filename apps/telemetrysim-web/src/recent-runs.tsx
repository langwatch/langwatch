import { Panel, Table } from "@langwatch/design-system-internal";
import { SimTime } from "@langwatch/sim-console";

import type { Run } from "./telemetry-api.ts";

const runKey = (run: Run) => run.startedAt.toISOString();

/** The runs before the current one, newest first. */
export const RecentRuns = ({ runs }: { runs: Run[] }) => (
  <Panel title="Recent runs" meta={String(runs.length)}>
    <Table
      caption="Recent runs"
      rows={runs}
      rowKey={runKey}
      empty="No earlier runs."
      columns={[
        { key: "started", header: "Started", cell: (run) => <SimTime at={run.startedAt} /> },
        { key: "mode", header: "Verb", cell: (run) => run.mode },
        { key: "preset", header: "Preset", cell: (run) => run.preset, mono: true },
        { key: "seed", header: "Seed", cell: (run) => String(run.seed), mono: true },
        { key: "state", header: "State", cell: (run) => run.state },
        { key: "sent", header: "Sent", cell: (run) => String(run.sent), align: "end" },
        { key: "acked", header: "Acked", cell: (run) => String(run.acked), align: "end" },
        {
          key: "failed",
          header: "Refused + failed",
          cell: (run) => String(run.refused + run.failed),
          align: "end",
        },
      ]}
    />
  </Panel>
);
