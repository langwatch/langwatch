import { Button, Text } from "@chakra-ui/react";
import { Columns3 } from "lucide-react";
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

const SECTIONS: { key: ColumnConfig["section"]; title: string }[] = [
  { key: "standard", title: "Standard" },
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
        <Button size="xs" variant="outline" fontWeight="normal">
          <Columns3 size={12} />
          Columns
        </Button>
      </MenuTrigger>
      <MenuContent
        minWidth="160px"
        maxHeight="320px"
        overflowY="auto"
        textStyle="xs"
        paddingY={1}
      >
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
