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

export const ColumnsDropdown: React.FC = () => {
  const columnOrder = useViewStore((s) => s.columnOrder);
  const hiddenColumns = useViewStore((s) => s.hiddenColumns);
  const toggleColumn = useViewStore((s) => s.toggleColumn);

  const isVisible = (id: string) =>
    columnOrder.includes(id) && !hiddenColumns.has(id);

  const sections: { key: ColumnConfig["section"]; title: string }[] = [
    { key: "standard", title: "Standard" },
    { key: "evaluations", title: "Evaluations" },
    { key: "events", title: "Events" },
  ];

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
        {sections.map(({ key, title }) => {
          const cols = STANDARD_COLUMNS.filter((c) => c.section === key);
          if (cols.length === 0) return null;
          return (
            <MenuItemGroup
              key={key}
              title={title}
              css={{
                "& [data-scope=menu][data-part=item-group-label]": {
                  fontSize: "2xs",
                  paddingY: "1",
                  paddingX: "2",
                  color: "fg.subtle",
                  textTransform: "uppercase",
                  letterSpacing: "wide",
                },
              }}
            >
              {cols.map((col) => (
                <MenuCheckboxItem
                  key={col.id}
                  value={col.id}
                  checked={isVisible(col.id)}
                  disabled={!!col.pinned}
                  fontSize="xs"
                  paddingY={1}
                  onCheckedChange={() => {
                    if (!col.pinned) toggleColumn(col.id);
                  }}
                >
                  {col.label}
                  {col.pinned && (
                    <Text marginLeft="auto" textStyle="2xs" color="fg.subtle">
                      pinned
                    </Text>
                  )}
                </MenuCheckboxItem>
              ))}
            </MenuItemGroup>
          );
        })}
      </MenuContent>
    </MenuRoot>
  );
};
