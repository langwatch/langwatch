import { Box, Button, HStack, Icon, IconButton, Text } from "@chakra-ui/react";
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Columns3,
  GripVertical,
  X,
} from "lucide-react";
import type React from "react";
import {
  MenuCheckboxItem,
  MenuContent,
  MenuItemGroup,
  MenuRoot,
  MenuTrigger,
} from "../../../../components/ui/menu";
import { toaster } from "../../../../components/ui/toaster";
import {
  LENS_CAPABILITIES,
  type LensColumnOption,
} from "../../lens/capabilities";
import { useViewStore } from "../../stores/viewStore";

// Section ordering within the dropdown. Sections discovered on the
// active grouping's capability are rendered in this order; anything
// else falls through to the end alphabetically.
const SECTION_ORDER = ["Standard", "Trace fields", "Evaluations", "Events"];

const SECTION_LABEL_CSS = {
  "& [data-scope=menu][data-part=item-group-label]": {
    fontSize: "2xs",
    paddingY: "1",
    paddingX: "2",
    color: "fg.subtle",
    textTransform: "uppercase",
    letterSpacing: "wide",
  },
};

export const ColumnsDropdown: React.FC = () => {
  const columnOrder = useViewStore((s) => s.columnOrder);
  const toggleColumn = useViewStore((s) => s.toggleColumn);
  const reorderColumns = useViewStore((s) => s.reorderColumns);
  const grouping = useViewStore((s) => s.grouping);

  // Source columns from the active grouping's capability — not the
  // flat-trace constant. Each grouping has its own column registry
  // (trace / conversation / group) and silently drops unknown ids,
  // so a dropdown wired to the wrong list produces toggles that
  // appear to do nothing. This keeps the dropdown and the rich
  // LensConfigDialog reading the same data.
  const capability = LENS_CAPABILITIES[grouping];
  const sections = groupColumnsBySection(capability.columns);
  const columnById = new Map(capability.columns.map((c) => [c.id, c]));
  const isVisible = (id: string) => columnOrder.includes(id);
  // Visible columns rendered in their current order — drives the
  // "Visible order" reorder strip at the top of the dropdown. Pinned
  // columns are filtered out because moving them is a no-op (the
  // table layout pins them regardless of order).
  const orderedVisibleColumns = columnOrder
    .map((id) => columnById.get(id))
    .filter((c): c is LensColumnOption => !!c && !c.pinned);

  // Drag-reorder for the "Visible order" strip. Activation distance
  // mirrors the table header's so a stray click on the grip doesn't
  // kick off a drag — power users get DnD, keyboard users keep the
  // up/down arrows. Both call into the same `reorderColumns` action.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const fromIdx = orderedVisibleColumns.findIndex(
      (c) => c.id === String(active.id),
    );
    const toIdx = orderedVisibleColumns.findIndex(
      (c) => c.id === String(over.id),
    );
    if (fromIdx < 0 || toIdx < 0) return;
    reorderColumns(
      columnOrder.indexOf(orderedVisibleColumns[fromIdx]!.id),
      columnOrder.indexOf(orderedVisibleColumns[toIdx]!.id),
    );
  };

  return (
    <MenuRoot closeOnSelect={false}>
      <MenuTrigger asChild>
        <Button
          size="xs"
          variant="outline"
          aria-label="Show or hide columns in the table"
          gap={1}
          paddingX={2}
        >
          <Columns3 size={14} />
          <ChevronDown size={12} />
        </Button>
      </MenuTrigger>
      <MenuContent
        minWidth="200px"
        // Lift the cap so all 17 columns + section headers fit without
        // scrolling on most screens. The dialog version of the same
        // picker shows everything at once; the dropdown should too —
        // hidden sections below the fold made it look like the dropdown
        // exposed fewer columns than the dialog (it doesn't).
        maxHeight="min(560px, 70vh)"
        overflowY="auto"
        textStyle="xs"
        paddingY={1}
      >
        <Box
          paddingX={3}
          paddingY={2}
          borderBottomWidth="1px"
          borderColor="border.subtle"
        >
          <Text
            textStyle="2xs"
            fontWeight="semibold"
            color="fg.muted"
            textTransform="uppercase"
            letterSpacing="0.06em"
          >
            Columns
          </Text>
        </Box>
        {orderedVisibleColumns.length > 1 && (
          // Reorder strip — drag the grip handle, or use the up/down
          // arrows for a keyboard-accessible fallback. Both paths call
          // into the same `reorderColumns` action. Drag-and-drop also
          // works on the table header itself; surfacing it inside the
          // dropdown gives operators a less-distracting "lay out my
          // columns away from the live data" workflow.
          <Box
            paddingX={2}
            paddingY={1.5}
            borderBottomWidth="1px"
            borderColor="border.subtle"
          >
            <Text
              textStyle="2xs"
              fontWeight="semibold"
              color="fg.muted"
              textTransform="uppercase"
              letterSpacing="0.06em"
              paddingX={1}
              paddingBottom={1}
            >
              Visible order
            </Text>
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={orderedVisibleColumns.map((c) => c.id)}
                strategy={verticalListSortingStrategy}
              >
                {orderedVisibleColumns.map((column, index) => (
                  <SortableVisibleColumnRow
                    key={column.id}
                    column={column}
                    isFirst={index === 0}
                    isLast={index === orderedVisibleColumns.length - 1}
                    onMoveUp={() => {
                      const previous = orderedVisibleColumns[index - 1];
                      if (!previous) return;
                      reorderColumns(
                        columnOrder.indexOf(column.id),
                        columnOrder.indexOf(previous.id),
                      );
                    }}
                    onMoveDown={() => {
                      const next = orderedVisibleColumns[index + 1];
                      if (!next) return;
                      reorderColumns(
                        columnOrder.indexOf(column.id),
                        columnOrder.indexOf(next.id),
                      );
                    }}
                    onRemove={() => toggleColumn(column.id)}
                  />
                ))}
              </SortableContext>
            </DndContext>
          </Box>
        )}
        {sections.map(({ title, columns }) => (
          <MenuItemGroup key={title} title={title} css={SECTION_LABEL_CSS}>
            {columns.map((column) => (
              <ColumnCheckbox
                key={column.id}
                column={column}
                checked={isVisible(column.id)}
                onToggle={() => {
                  const wasVisible = isVisible(column.id);
                  toggleColumn(column.id);
                  // When adding (not removing), surface a toast that
                  // tells the user (a) where the column landed and
                  // (b) how to reposition it. Without this the column
                  // was silently appended to the end of the row and
                  // power users had no idea their click "worked" if
                  // they didn't notice the new header off-screen.
                  if (!wasVisible) {
                    toaster.create({
                      title: `Added "${column.label}"`,
                      description:
                        "Appears at the end. Use the arrows in “Visible order” to reposition.",
                      type: "info",
                      duration: 4500,
                    });
                  }
                }}
              />
            ))}
          </MenuItemGroup>
        ))}
      </MenuContent>
    </MenuRoot>
  );
};

const ColumnCheckbox: React.FC<{
  column: LensColumnOption;
  checked: boolean;
  onToggle: () => void;
}> = ({ column, checked, onToggle }) => {
  const isPinned = !!column.pinned;
  return (
    <MenuCheckboxItem
      value={column.id}
      checked={checked}
      disabled={isPinned}
      // Ark splits closeOnSelect at the item level, not the root, so the
      // MenuRoot-level setting doesn't reach MenuCheckboxItem. Set it here
      // so toggling stays open for multi-column changes.
      closeOnSelect={false}
      fontSize="xs"
      paddingY={1}
      onCheckedChange={() => {
        if (!isPinned) onToggle();
      }}
    >
      {column.label}
      {isPinned && (
        <Text marginLeft="auto" textStyle="2xs" color="fg.subtle">
          pinned
        </Text>
      )}
    </MenuCheckboxItem>
  );
};

/**
 * One row of the "Visible order" reorder strip. Wraps `useSortable` so
 * the row can be dragged via its grip handle, while keeping the
 * arrow + remove buttons callable independently. Resolve the neighbour
 * from the VISIBLE-order strip up in the parent and only then translate
 * back into the full `columnOrder` index space — using `columnOrder ± 1`
 * directly would target whatever the next unfiltered index happens to
 * be (typically a pinned column sitting between two reorderable ones),
 * and the move would silently no-op against the pinned slot.
 */
interface SortableVisibleColumnRowProps {
  column: LensColumnOption;
  isFirst: boolean;
  isLast: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
}

const SortableVisibleColumnRow: React.FC<SortableVisibleColumnRowProps> = ({
  column,
  isFirst,
  isLast,
  onMoveUp,
  onMoveDown,
  onRemove,
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: column.id });
  return (
    <HStack
      ref={setNodeRef}
      // CSS.Translate (not CSS.Transform) — vertical list, same reason
      // as the table header: avoid baked-in scaleX/scaleY when row
      // heights are uniform but we want to be defensive.
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
        opacity: isDragging ? 0.6 : 1,
      }}
      gap={1}
      paddingX={1}
      paddingY={0.5}
      _hover={{ bg: "bg.muted" }}
      borderRadius="sm"
    >
      <Box
        {...attributes}
        {...(listeners ?? {})}
        display="inline-flex"
        alignItems="center"
        justifyContent="center"
        width="14px"
        height="14px"
        color="fg.subtle"
        cursor="grab"
        _hover={{ color: "fg" }}
        _active={{ cursor: "grabbing" }}
        aria-label={`Drag to reorder ${column.label}`}
        title={`Drag to reorder ${column.label}`}
        onClick={(e) => e.stopPropagation()}
      >
        <Icon boxSize="11px">
          <GripVertical />
        </Icon>
      </Box>
      <Text textStyle="xs" color="fg" flex={1} truncate>
        {column.label}
      </Text>
      <IconButton
        aria-label={`Move ${column.label} up`}
        size="2xs"
        variant="ghost"
        disabled={isFirst}
        onClick={onMoveUp}
      >
        <ArrowUp size={11} />
      </IconButton>
      <IconButton
        aria-label={`Move ${column.label} down`}
        size="2xs"
        variant="ghost"
        disabled={isLast}
        onClick={onMoveDown}
      >
        <ArrowDown size={11} />
      </IconButton>
      <IconButton
        aria-label={`Remove ${column.label}`}
        size="2xs"
        variant="ghost"
        color="fg.subtle"
        onClick={onRemove}
      >
        <X size={11} />
      </IconButton>
    </HStack>
  );
};

function groupColumnsBySection(
  columns: readonly LensColumnOption[],
): Array<{ title: string; columns: LensColumnOption[] }> {
  const byTitle = new Map<string, LensColumnOption[]>();
  for (const c of columns) {
    const title = c.section ?? "Other";
    const bucket = byTitle.get(title) ?? [];
    bucket.push(c);
    byTitle.set(title, bucket);
  }
  // Sort by SECTION_ORDER, leftover sections alphabetically at the end.
  const ordered = [...byTitle.entries()].sort(([a], [b]) => {
    const ai = SECTION_ORDER.indexOf(a);
    const bi = SECTION_ORDER.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
  return ordered.map(([title, cols]) => ({ title, columns: cols }));
}
