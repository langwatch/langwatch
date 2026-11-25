import { Button } from "@chakra-ui/react";
import { ChevronDown, Columns3 } from "lucide-react";

import { Menu } from "../overlays/menu.tsx";

export interface ColumnPickerColumn {
  value: string;
  label: string;
  visible: boolean;
  /** A locked column is shown, checked, and cannot be turned off. */
  locked?: boolean;
}

export interface ColumnPickerProps {
  columns: readonly ColumnPickerColumn[];
  onVisibleChange: (args: { value: string; visible: boolean }) => void;
  onReset?: () => void;
}

/** "Columns": a ghost button opening a menu of labelled checkbox items, one per column. */
export function ColumnPicker({ columns, onVisibleChange, onReset }: ColumnPickerProps) {
  const shown = columns.filter((column) => column.visible).length;
  return (
    <Menu.Root positioning={{ placement: "bottom-end" }} closeOnSelect={false}>
      <Menu.Trigger asChild>
        <Button variant="ghost" size="sm" aria-label="Show or hide columns" gap={1.5}>
          <Columns3 size={14} aria-hidden />
          Columns
          <ChevronDown size={14} aria-hidden />
        </Button>
      </Menu.Trigger>
      <Menu.Content minWidth="220px" maxHeight="min(70vh, 520px)" overflowY="auto">
        <Menu.ItemGroup title={`${shown} of ${columns.length} shown`}>
          {columns.map((column) => (
            <Menu.CheckboxItem
              key={column.value}
              value={column.value}
              checked={column.visible}
              disabled={column.locked}
              onCheckedChange={(visible) => onVisibleChange({ value: column.value, visible })}
            >
              {column.label}
            </Menu.CheckboxItem>
          ))}
        </Menu.ItemGroup>
        {onReset && (
          <>
            <Menu.Separator />
            <Menu.Item value="reset-columns" closeOnSelect onClick={onReset}>
              Reset to default
            </Menu.Item>
          </>
        )}
      </Menu.Content>
    </Menu.Root>
  );
}
