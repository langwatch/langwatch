import {
  Badge,
  Button,
  Link,
  Panel,
  Table,
  type TableColumn,
} from "@langwatch/design-system-internal";

import type { HubWorktree } from "../shared/contract.ts";

const noteOf = ({ worktree }: { worktree: HubWorktree }) => {
  if (worktree.isPrimary) return "primary, protected";
  if (worktree.isCurrent) return "current, protected";
  return "";
};

export type IdleWorktreesProps = {
  worktrees: HubWorktree[];
  /** The directory whose start is in flight. */
  starting: string | undefined;
  onStart: (worktree: HubWorktree) => void;
};

/** Worktrees haven knows with nothing running, each one start away. */
export const IdleWorktrees = ({ worktrees, starting, onStart }: IdleWorktreesProps) => {
  const columns: TableColumn<HubWorktree>[] = [
    {
      key: "name",
      header: "Worktree",
      width: "30%",
      title: (worktree) => worktree.dir,
      cell: (worktree) =>
        worktree.homeUrl === "" ? (
          worktree.name
        ) : (
          <Link href={worktree.homeUrl} title={worktree.dir}>
            {worktree.name}
          </Link>
        ),
    },
    {
      key: "branch",
      header: "Branch",
      muted: true,
      hideOnNarrow: true,
      cell: (worktree) => worktree.branch,
    },
    {
      key: "note",
      header: "",
      width: "200px",
      hideOnNarrow: true,
      cell: (worktree) => {
        const note = noteOf({ worktree });
        return note === "" ? null : <Badge>{note}</Badge>;
      },
    },
    {
      key: "start",
      header: "",
      width: "96px",
      align: "end",
      cell: (worktree) =>
        worktree.canStart ? (
          <Button
            size="sm"
            loading={starting === worktree.dir}
            disabled={starting !== undefined && starting !== worktree.dir}
            onClick={() => onStart(worktree)}
            title={`Start the stack in ${worktree.dir}`}
          >
            Start
          </Button>
        ) : null,
    },
  ];
  return (
    <Panel>
      <Table
        columns={columns}
        rows={worktrees}
        rowKey={(worktree) => worktree.dir}
        caption="Worktrees with nothing running"
      />
    </Panel>
  );
};
