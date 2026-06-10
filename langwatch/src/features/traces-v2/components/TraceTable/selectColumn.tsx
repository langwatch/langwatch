import { type ColumnDef, createColumnHelper } from "@tanstack/react-table";
import type { TraceListItem } from "../../types/trace";
import type { ConversationGroup } from "./conversationGroups";
import type { TraceGroup } from "./registry/cells/group/types";
import { SELECT_COLUMN_ID } from "./registry/cells/SelectCells";
import { SelectHeaderCheckbox } from "./SelectHeaderCheckbox";

const SELECT_COLUMN_SIZE = 36;

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
    header: ({ table }) => (
      <SelectHeaderCheckbox
        traceIds={table
          .getCoreRowModel()
          .rows.map((r) => (r.original as TraceListItem).traceId)}
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
        traceIds={table
          .getCoreRowModel()
          .rows.flatMap((r) =>
            (r.original as ConversationGroup).traces.map((t) => t.traceId),
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
        traceIds={table
          .getCoreRowModel()
          .rows.flatMap((r) =>
            (r.original as TraceGroup).traces.map((t) => t.traceId),
          )}
      />
    ),
  });
