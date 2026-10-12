import { ListTable } from "@langwatch/design-system/list-table";
import { Pagination } from "@langwatch/design-system/pagination";
import { HStack, Table, Text } from "@langwatch/design-system/primitives";
import type { ReactNode } from "react";
import { ChevronDown, ChevronRight } from "react-feather";

import type { ExperimentListControls } from "../../../behavior/experiments/use-experiment-list-view.ts";
import type { ExperimentGroup } from "../../../model/experiments/experiment-list-filter.ts";
import type { ExperimentListRow } from "../../../model/experiments/experiment-list-row.ts";
import { PAGE_SIZE_OPTIONS } from "../../elements/navigation-footer.tsx";
import { LIST_COLUMN_COUNT } from "./experiment-row-details.tsx";

/** The table's header, which stays while the rows load. */
export function ExperimentListHeader() {
  return (
    <Table.Header>
      <Table.Row>
        <Table.ColumnHeader width="48px" aria-label="Open or close the row" />
        <Table.ColumnHeader width="25%">Experiment</Table.ColumnHeader>
        <Table.ColumnHeader width="29%">Result, latest run</Table.ColumnHeader>
        <Table.ColumnHeader width="10%">Runs</Table.ColumnHeader>
        <Table.ColumnHeader width="9%" textAlign="end">
          Cost, latest run
        </Table.ColumnHeader>
        <Table.ColumnHeader width="12%">Status</Table.ColumnHeader>
        <Table.ColumnHeader width="10%">Last run started</Table.ColumnHeader>
        <ListTable.ActionHeader />
      </Table.Row>
    </Table.Header>
  );
}

/** The rows, their group headings when grouped, and a line when a filter leaves none. */
export function ExperimentListBody({
  groups,
  matching,
  grouped,
  collapsed,
  onToggleGroup,
  renderRow,
}: {
  groups: ExperimentGroup[];
  matching: ExperimentListRow[];
  grouped: boolean;
  collapsed: string[];
  onToggleGroup: (key: string) => void;
  renderRow: (experiment: ExperimentListRow) => ReactNode;
}) {
  return (
    <>
      {matching.length === 0 && (
        <ListTable.SpanRow columns={LIST_COLUMN_COUNT}>
          <Text textStyle="bodySm" color="fg.muted" padding={6} textAlign="center">
            No experiments match these filters.
          </Text>
        </ListTable.SpanRow>
      )}
      {groups.map((group) => (
        <ExperimentGroupRows
          key={group.key || "all"}
          group={group}
          grouped={grouped}
          collapsed={collapsed.includes(group.key)}
          onToggleGroup={() => onToggleGroup(group.key)}
          renderRow={renderRow}
        />
      ))}
    </>
  );
}

/** A group's heading row (when grouped) and, unless it is folded away, its experiments. */
function ExperimentGroupRows({
  group,
  grouped,
  collapsed,
  onToggleGroup,
  renderRow,
}: {
  group: ExperimentGroup;
  grouped: boolean;
  collapsed: boolean;
  onToggleGroup: () => void;
  renderRow: (experiment: ExperimentListRow) => ReactNode;
}) {
  return (
    <>
      {grouped && (
        <ListTable.SpanRow columns={LIST_COLUMN_COUNT} band>
          <HStack
            as="button"
            width="full"
            gap={2}
            paddingX={4}
            paddingY={2}
            cursor="pointer"
            textAlign="start"
            aria-expanded={!collapsed}
            onClick={onToggleGroup}
          >
            {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
            <Text textStyle="label">{group.key}</Text>
            <Text textStyle="caption" color="fg.muted">
              {group.rows.length} {group.rows.length === 1 ? "experiment" : "experiments"}
            </Text>
          </HStack>
        </ListTable.SpanRow>
      )}
      {!collapsed && group.rows.map(renderRow)}
    </>
  );
}

/** Paging over the matches of an active search: they are all here, so the page is cut here. */
export function FilteredPagination({
  controls,
  page,
  total,
  visible,
  isLoading,
}: {
  controls: ExperimentListControls;
  /** The page being shown, kept inside the last one. */
  page: number;
  total: number;
  visible: number;
  isLoading: boolean;
}) {
  return (
    <Pagination
      page={page}
      pageSize={controls.paging.pageSize}
      totalCount={total}
      visibleCount={visible}
      unitLabel="experiments"
      pageSizeOptions={PAGE_SIZE_OPTIONS}
      isLoading={isLoading}
      onPageChange={controls.goToPage}
      onPageSizeChange={controls.changePageSize}
    />
  );
}
