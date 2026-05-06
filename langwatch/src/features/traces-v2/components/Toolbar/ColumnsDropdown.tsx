import { Box, Button, Text } from "@chakra-ui/react";
import { ChevronDown, Columns3 } from "lucide-react";
import type React from "react";
import {
  MenuCheckboxItem,
  MenuContent,
  MenuItemGroup,
  MenuRoot,
  MenuTrigger,
} from "../../../../components/ui/menu";
import { STANDARD_COLUMNS } from "../../constants/columns";
import type { ColumnConfig } from "../../stores/viewStore";
import { useViewStore } from "../../stores/viewStore";

// Section labels mirror the lens-config dialog so the two surfaces read
// as the same picker. Previously the standard section had no label, so
// users skimming the dropdown couldn't tell where Standard ended and
// Evaluations began without scrolling.
const SECTIONS: { key: ColumnConfig["section"]; title: string }[] = [
  { key: "standard", title: "Standard" },
  { key: "fields", title: "Trace fields" },
  { key: "evaluations", title: "Evaluations" },
  { key: "events", title: "Events" },
];

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

  const isVisible = (id: string) => columnOrder.includes(id);

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
        {SECTIONS.map(({ key, title }) => {
          const columns = STANDARD_COLUMNS.filter((c) => c.section === key);
          if (columns.length === 0) return null;
          return (
            <MenuItemGroup key={key} title={title} css={SECTION_LABEL_CSS}>
              {columns.map((column) => (
                <ColumnCheckbox
                  key={column.id}
                  column={column}
                  checked={isVisible(column.id)}
                  onToggle={() => toggleColumn(column.id)}
                />
              ))}
            </MenuItemGroup>
          );
        })}
      </MenuContent>
    </MenuRoot>
  );
};

const ColumnCheckbox: React.FC<{
  column: ColumnConfig;
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
