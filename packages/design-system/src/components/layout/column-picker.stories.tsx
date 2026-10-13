import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { ColumnPicker, type ColumnPickerColumn } from "./column-picker.tsx";

const COLUMNS: ColumnPickerColumn[] = [
  { value: "name", label: "Name", visible: true, locked: true },
  { value: "status", label: "Status", visible: true },
  { value: "owner", label: "Owner", visible: false },
  { value: "created", label: "Created", visible: true },
];

function Demo() {
  const [columns, setColumns] = useState(COLUMNS);
  return (
    <ColumnPicker
      columns={columns}
      onVisibleChange={({ value, visible }) =>
        setColumns((now) => now.map((c) => (c.value === value ? { ...c, visible } : c)))
      }
      onReset={() => setColumns(COLUMNS)}
    />
  );
}

const meta = {
  title: "Data display/Column picker",
  component: ColumnPicker,
  tags: ["autodocs"],
  parameters: {
    usage: {
      use: "Show or hide a table's columns: a Columns button opening a menu of labelled checkboxes. A locked column is checked and cannot be turned off. It lives in TableToolbar.",
      avoid: "Filtering rows: the toolbar's search and filters. Choosing a sort: a SortHeader.",
    },
  },
  args: { columns: [], onVisibleChange: () => undefined },
} satisfies Meta<typeof ColumnPicker>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { render: () => <Demo /> };
