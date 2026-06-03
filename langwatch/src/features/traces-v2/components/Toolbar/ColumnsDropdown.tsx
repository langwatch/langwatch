import { Box, Button, HStack, IconButton, Text } from "@chakra-ui/react";
import { ArrowDown, ArrowUp, ChevronDown, Columns3, X } from "lucide-react";
import type React from "react";
import {
  MenuCheckboxItem,
  MenuContent,
  MenuItemGroup,
  MenuRoot,
  MenuTrigger,
} from "../../../../components/ui/menu";
import { toaster } from "../../../../components/ui/toaster";
import { LENS_CAPABILITIES, type LensColumnOption } from "../../lens/capabilities";
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
          // Reorder strip — appears above the toggle list. Each row
          // shows a currently-visible column with up/down arrows that
          // call `reorderColumns`. The full-blown drag-and-drop UI
          // doesn't fit cleanly inside a Chakra Menu (the menu
          // dismisses on outside-pointer-down which fights drag), so
          // we surface the same `reorderColumns` action via keyboard-
          // accessible arrow buttons. Power users who want full DnD
          // still have the table header (when that lands) and the
          // LensConfigDialog (when it grows a reorder section).
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
            {orderedVisibleColumns.map((column, index) => (
              <HStack
                key={column.id}
                gap={1}
                paddingX={1}
                paddingY={0.5}
                _hover={{ bg: "bg.muted" }}
                borderRadius="sm"
              >
                <Text textStyle="xs" color="fg" flex={1} truncate>
                  {column.label}
                </Text>
                <IconButton
                  aria-label={`Move ${column.label} up`}
                  size="2xs"
                  variant="ghost"
                  disabled={index === 0}
                  onClick={() => reorderColumns(
                    columnOrder.indexOf(column.id),
                    columnOrder.indexOf(column.id) - 1,
                  )}
                >
                  <ArrowUp size={11} />
                </IconButton>
                <IconButton
                  aria-label={`Move ${column.label} down`}
                  size="2xs"
                  variant="ghost"
                  disabled={index === orderedVisibleColumns.length - 1}
                  onClick={() => reorderColumns(
                    columnOrder.indexOf(column.id),
                    columnOrder.indexOf(column.id) + 1,
                  )}
                >
                  <ArrowDown size={11} />
                </IconButton>
                <IconButton
                  aria-label={`Remove ${column.label}`}
                  size="2xs"
                  variant="ghost"
                  color="fg.subtle"
                  onClick={() => toggleColumn(column.id)}
                >
                  <X size={11} />
                </IconButton>
              </HStack>
            ))}
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
