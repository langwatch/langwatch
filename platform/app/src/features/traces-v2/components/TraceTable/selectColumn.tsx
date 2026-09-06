import { type ColumnDef, createColumnHelper } from "@tanstack/react-table";
import type { TraceListItem } from "../../types/trace";
import type { ConversationGroup } from "./conversationGroups";
import type { TraceGroup } from "./registry/cells/group/types";
import { SELECT_COLUMN_ID } from "./registry/cells/SelectCells";
import { SelectHeaderCheckbox } from "./SelectHeaderCheckbox";
import { SkeletonSelectCell } from "./SkeletonCellContent";
import { withoutPlaceholderTraceIds } from "./skeletonPlaceholders";

const SELECT_COLUMN_SIZE = 36;

/**
 * What the trace table hands every header beyond the rows themselves.
 *
 * While the first page is in flight the table is fed placeholder rows, and the
 * header has no other way to tell them from real traces once they are inside
 * Tanstack's row model.
 */
export interface TraceTableMeta {
  isLoading?: boolean;
}

const isTableLoading = (table: { options: { meta?: unknown } }): boolean =>
  (table.options.meta as TraceTableMeta | undefined)?.isLoading === true;

const traceCol = createColumnHelper<TraceListItem>();
const convCol = createColumnHelper<ConversationGroup>();
const groupCol = createColumnHelper<TraceGroup>();

export const traceSelectColumnDef: ColumnDef<TraceListItem, any> =
  traceCol.display({
    id: SELECT_COLUMN_ID,
    size: SELECT_COLUMN_SIZE,
    minSize: SELECT_COLUMN_SIZE,
    enableSorting: false,
    enableResizing: false,
    // A placeholder row is not a trace, so while they stand in for the page the
    // header offers the same shimmer the row checkboxes do rather than a
    // working "select all" over ids that address nothing.
    header: ({ table }) =>
      isTableLoading(table) ? (
        <SkeletonSelectCell />
      ) : (
        <SelectHeaderCheckbox
          traceIds={withoutPlaceholderTraceIds(
            table
              .getCoreRowModel()
              .rows.map((r) => (r.original as TraceListItem).traceId),
          )}
        />
      ),
  });

export const conversationSelectColumnDef: ColumnDef<ConversationGroup, any> =
  convCol.display({
    id: SELECT_COLUMN_ID,
    size: SELECT_COLUMN_SIZE,
    minSize: SELECT_COLUMN_SIZE,
    enableSorting: false,
    enableResizing: false,
    header: ({ table }) => (
      <SelectHeaderCheckbox
        traceIds={withoutPlaceholderTraceIds(
          table
            .getCoreRowModel()
            .rows.flatMap((r) =>
              (r.original as ConversationGroup).traces.map((t) => t.traceId),
            ),
        )}
      />
    ),
  });

export const groupSelectColumnDef: ColumnDef<TraceGroup, any> =
  groupCol.display({
    id: SELECT_COLUMN_ID,
    size: SELECT_COLUMN_SIZE,
    minSize: SELECT_COLUMN_SIZE,
    enableSorting: false,
    enableResizing: false,
    header: ({ table }) => (
      <SelectHeaderCheckbox
        traceIds={withoutPlaceholderTraceIds(
          table
            .getCoreRowModel()
            .rows.flatMap((r) =>
              (r.original as TraceGroup).traces.map((t) => t.traceId),
            ),
        )}
      />
    ),
  });
