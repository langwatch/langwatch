import { Box, Button } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { Card } from "./card.tsx";
import { FilterChips } from "./filter-chips.tsx";
import { TableToolbar, type TableToolbarProps } from "./table-toolbar.tsx";

function Demo(props: Partial<TableToolbarProps>) {
  const [query, setQuery] = useState("");
  return (
    <TableToolbar
      search={{
        value: query,
        onChange: setQuery,
        placeholder: "Search models",
        ariaLabel: "Search models",
      }}
      filters={
        <FilterChips
          groupLabel="Provider"
          value="all"
          onChange={() => undefined}
          items={[
            { value: "all", label: "All", count: 40 },
            { value: "openai", label: "OpenAI", count: 12 },
          ]}
        />
      }
      summary="12 of 40 models"
      {...props}
    />
  );
}

const meta = {
  title: "Data display/Table toolbar",
  component: TableToolbar,
  tags: ["autodocs"],
  parameters: {
    usage: {
      use: "The one row above a table: search, a distinct lookup, filters, a summary with Clear filters, the column picker and actions. ListPage draws it from its toolbar prop; a table in a card or drawer uses it directly (attached inside a padding-none Card).",
      avoid: "Two toolbars, filter UI inside a column header, or a second search of the same list.",
    },
  },
} satisfies Meta<typeof TableToolbar>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { render: () => <Demo /> };
export const WithClearAndActions: Story = {
  render: () => (
    <Demo
      onClearFilters={() => undefined}
      actions={
        <Button size="sm" variant="outline">
          Export
        </Button>
      }
      columns={{
        columns: [
          { value: "name", label: "Name", visible: true, locked: true },
          { value: "cost", label: "Cost", visible: false },
        ],
        onVisibleChange: () => undefined,
      }}
    />
  ),
};
export const WithLookup: Story = {
  render: () => (
    <Demo
      lookup={{
        value: "",
        onChange: () => undefined,
        placeholder: "Which rule matches this model?",
        ariaLabel: "Find the rule for a model",
      }}
    />
  ),
};
export const Loading: Story = { render: () => <Demo disabled /> };
/** The inline selection bar is the first band of the toolbar. */
export const WithSelection: Story = {
  render: () => (
    <Demo
      selection={{
        label: "3 selected",
        onClear: () => undefined,
        children: <Button size="xs">Delete</Button>,
      }}
    />
  ),
};
export const AttachedToCard: Story = {
  render: () => (
    <Card padding="none">
      <Demo attached />
    </Card>
  ),
};
/** At 320px the row wraps; nothing overflows. */
export const Narrow: Story = {
  render: () => (
    <Box maxWidth="320px">
      <Demo
        onClearFilters={() => undefined}
        lookup={{
          value: "",
          onChange: () => undefined,
          placeholder: "Which rule matches?",
          ariaLabel: "Lookup",
        }}
        actions={
          <Button size="sm" variant="outline">
            Export
          </Button>
        }
      />
    </Box>
  ),
};
