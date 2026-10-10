import {
  Badge,
  Button,
  EmptyState,
  Panel,
  Section,
  Stack,
  Table,
  type TableColumn,
} from "@langwatch/design-system-internal";

import type { CapturedLine, LaneErrors } from "../shared/contract.ts";
import { formatClock, formatDateTime } from "../shared/format.ts";

const columns: TableColumn<CapturedLine>[] = [
  {
    key: "at",
    header: "Time",
    width: "96px",
    mono: true,
    muted: true,
    title: (line) => formatDateTime({ at: line.at }),
    cell: (line) => formatClock({ at: line.at }),
  },
  {
    key: "level",
    header: "Level",
    width: "104px",
    hideOnNarrow: true,
    cell: (line) => <Badge tone="error">{line.level}</Badge>,
  },
  { key: "text", header: "Message", mono: true, cell: (line) => line.text },
];

const LanePanel = ({ lane }: { lane: LaneErrors }) => (
  <Panel
    title={lane.lane}
    meta={lane.lines.length === 1 ? "1 line" : `${lane.lines.length} lines`}
    actions={
      <Button size="sm" href={lane.logsUrl}>
        Open in logs
      </Button>
    }
  >
    <Table
      columns={columns}
      rows={lane.lines}
      rowKey={(line) => `${line.at}:${line.text}`}
      caption={`Recent errors in ${lane.lane}`}
    />
  </Panel>
);

/** Each lane's newest error and fatal lines, newest first, each lane one click from its logs. */
export const RecentErrors = ({ errors }: { errors: LaneErrors[] }) => (
  <Section title="Recent errors" description="The newest error and fatal lines of each lane.">
    {errors.length === 0 ? (
      <Panel>
        <EmptyState
          title="No errors in the captured logs"
          description="Lanes that log an error or a fatal line show up here."
        />
      </Panel>
    ) : (
      <Stack gap={4}>
        {errors.map((lane) => (
          <LanePanel key={lane.lane} lane={lane} />
        ))}
      </Stack>
    )}
  </Section>
);
