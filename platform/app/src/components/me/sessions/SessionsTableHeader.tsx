import { Table } from "@chakra-ui/react";
import type React from "react";

import { SortableColumnHeader } from "../SortableColumnHeader";
import type { SessionsSortColumn, SessionsSortState } from "../useSessionsSort";

/**
 * The columns, in the order a reader scans them: what the session was and when
 * it last moved, then what it cost, then what it shipped. Every one of them
 * sorts, and the trailing column carries the row's overflow menu rather than a
 * value, so it has no label.
 */
export const SessionsTableHeader: React.FC<{
  sort: SessionsSortState;
  onSort: (column: SessionsSortColumn) => void;
}> = ({ sort, onSort }) => (
  <Table.Header>
    <Table.Row>
      <SortableColumnHeader
        label="Session"
        column="session"
        sort={sort}
        onSort={onSort}
      />
      {/* Shrink-to-fit with a floor: the label and timestamp columns grow
          with their widest cell and never drop below a width that keeps
          clear air before the next column, and the width they free goes to
          the Session column, which truncates. */}
      <SortableColumnHeader
        label="Agent"
        column="agent"
        sort={sort}
        onSort={onSort}
        width="1%"
        minWidth="150px"
      />
      <SortableColumnHeader
        label="Last update"
        column="lastUpdate"
        sort={sort}
        onSort={onSort}
        width="1%"
        minWidth="130px"
      />
      <SortableColumnHeader
        label="Context"
        column="context"
        sort={sort}
        onSort={onSort}
        align="end"
      />
      <SortableColumnHeader
        label="Compactions"
        column="compactions"
        sort={sort}
        onSort={onSort}
      />
      <SortableColumnHeader
        label="Active and waiting"
        column="activeTime"
        sort={sort}
        onSort={onSort}
      />
      <SortableColumnHeader
        label="Token cost"
        column="cost"
        sort={sort}
        onSort={onSort}
        align="end"
      />
      <SortableColumnHeader
        label="Pull requests"
        column="pullRequests"
        sort={sort}
        onSort={onSort}
      />
      <Table.ColumnHeader width={12} />
    </Table.Row>
  </Table.Header>
);
