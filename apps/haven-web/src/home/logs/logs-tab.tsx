import {
  Badge,
  Callout,
  Panel,
  Stack,
  Table,
  Tabs,
  type TableColumn,
} from "@langwatch/design-system-internal";
import { useState } from "react";

import { errorGroupSchema, type ErrorGroup } from "../../shared/contract.ts";
import { formatAge } from "../../shared/format.ts";
import { LogsBrowser } from "../../shared/logs-browser.tsx";
import { useCliRows } from "../../shared/use-cli-rows.ts";

const ERRORS = "errors";

const columnsAt = ({ now }: { now: number }): TableColumn<ErrorGroup>[] => [
  {
    key: "count",
    header: "Count",
    width: "80px",
    align: "end",
    cell: (group) => <Badge tone="error">{group.count}</Badge>,
  },
  { key: "lane", header: "Lane", width: "120px", mono: true, cell: (group) => group.lane },
  { key: "message", header: "Message", mono: true, cell: (group) => group.message },
  {
    key: "last",
    header: "Last seen",
    width: "120px",
    muted: true,
    hideOnNarrow: true,
    cell: (group) => formatAge({ at: group.lastSeen, now }),
  },
];

/** `haven errors`: the last distinct failures across every lane, grouped and counted. */
const ErrorsPanel = ({ slug, now }: { slug: string; now: number }) => {
  const errors = useCliRows({ slug, name: "errors", row: errorGroupSchema });
  if (errors.error !== undefined && errors.data === undefined) {
    return (
      <Callout tone="error" title="The errors could not be read">
        {errors.error}
      </Callout>
    );
  }
  return (
    <Panel title="Errors" meta={`${errors.data?.length ?? 0} distinct`}>
      <Table
        columns={columnsAt({ now })}
        rows={errors.data ?? []}
        rowKey={(group) => group.signature}
        caption="Distinct failures of this stack"
        empty="No failures in the captured logs"
      />
    </Panel>
  );
};

/** The Logs & errors tab: `haven logs` and `haven errors` for this stack. */
export const LogsTab = ({
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
  const [lane, setLane] = useState("");
  const current = sub === ERRORS ? ERRORS : "";
  return (
    <Stack gap={4}>
      <Tabs
        label="Logs and errors"
        tabs={[
          { id: "", label: "Logs" },
          { id: ERRORS, label: "Errors" },
        ]}
        value={current}
        onChange={onSub}
      />
      {current === ERRORS ? (
        <ErrorsPanel slug={slug} now={now} />
      ) : (
        <LogsBrowser
          stack={slug}
          lane={lane}
          onSelect={(selection) => setLane(selection.lane)}
          focusRequest={0}
        />
      )}
    </Stack>
  );
};
