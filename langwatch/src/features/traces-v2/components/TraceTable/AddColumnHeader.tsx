import { IconButton } from "@chakra-ui/react";
import { type ColumnDef, createColumnHelper } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import type React from "react";
import { Popover } from "../../../../components/ui/popover";
import type { TraceListItem } from "../../types/trace";
import { ColumnPickerContent } from "../Toolbar/ColumnPickerContent";

/** Id of the trailing "+" column. Kept out of the lens column list — it's a
 *  synthetic UI affordance, like the leading row-select column. */
export const ADD_COLUMN_ID = "__add_column__";

/**
 * Header for the trailing "+" column: a plus button that opens the column
 * picker, giving columns the same discoverability the toolbar button does
 * but anchored where new columns appear.
 */
const AddColumnHeader: React.FC = () => (
  <Popover.Root positioning={{ placement: "bottom-end" }}>
    <Popover.Trigger asChild>
      <IconButton
        aria-label="Add a column"
        title="Add a column"
        size="2xs"
        variant="ghost"
        color="fg.subtle"
        _hover={{ color: "fg", bg: "bg.muted" }}
      >
        <Plus size={14} />
      </IconButton>
    </Popover.Trigger>
    <Popover.Content width="auto" padding={0}>
      <ColumnPickerContent />
    </Popover.Content>
  </Popover.Root>
);

const col = createColumnHelper<TraceListItem>();

/**
 * The trailing "+" column def: fixed-width, non-reorderable, non-sortable,
 * non-resizable. Its body cells are empty (no registry cell is keyed to
 * ADD_COLUMN_ID, so the registry renders nothing); only the header carries
 * the picker trigger.
 */
export const addColumnColumnDef: ColumnDef<TraceListItem, any> = col.display({
  id: ADD_COLUMN_ID,
  header: () => <AddColumnHeader />,
  size: 44,
  minSize: 44,
  maxSize: 44,
  enableResizing: false,
  enableSorting: false,
});
