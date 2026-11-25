import { Box, Button, HStack, Text } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { SelectionActionBar } from "./selection-action-bar.tsx";

const meta = {
  title: "Data display/Selection action bar",
  component: SelectionActionBar,
  tags: ["autodocs"],
  args: {
    label: "3 traces selected",
    onClear: () => undefined,
  },
  argTypes: { children: { control: false }, label: { control: "text" } },
  parameters: {
    usage: {
      use: "The floating bar of bulk actions once rows of a list are selected (selection-action-bar.md).",
      avoid:
        "Actions on one row: a Menu in the row's overflow cell (row-actions-overflow-menu.md).",
    },
    layout: "fullscreen",
  },
  render: (args) => (
    <Box height="220px" position="relative">
      <SelectionActionBar {...args} />
    </Box>
  ),
} satisfies Meta<typeof SelectionActionBar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Only the count and the clear control: nothing can be done with the selection yet. */
export const Default: Story = {};

export const WithActions: Story = {
  args: {
    children: (
      <HStack gap="1">
        <Button size="xs" variant="ghost">
          Add to dataset
        </Button>
        <Button size="xs" variant="ghost" colorPalette="red">
          Delete
        </Button>
      </HStack>
    ),
  },
};

export const OneSelected: Story = {
  args: { label: "1 trace selected" },
};

/** An action still running keeps the bar up and the buttons disabled. */
export const Busy: Story = {
  args: {
    children: (
      <Button size="xs" variant="ghost" loading>
        Adding to dataset
      </Button>
    ),
  },
};

export const LongLabel: Story = {
  args: {
    label: (
      <Text textStyle="sm" fontWeight="medium">
        248 traces selected across every page of the current filter
      </Text>
    ),
  },
};

/** Inline: one band in normal flow, for a drawer, a dialog or a table in a card. */
export const Inline: Story = {
  args: {
    placement: "inline",
    children: (
      <Button size="xs" variant="ghost">
        Add to dataset
      </Button>
    ),
  },
  render: (args) => (
    <Box maxWidth="560px">
      <SelectionActionBar {...args} />
    </Box>
  ),
};

/** At 320px the label and the actions wrap, and the bar stays inside the viewport. */
export const Narrow: Story = {
  args: {
    label: "Select all 212 matching traces",
    children: (
      <>
        <Button size="xs" variant="ghost">
          Add to dataset
        </Button>
        <Button size="xs" variant="ghost" colorPalette="red">
          Delete
        </Button>
      </>
    ),
  },
  render: (args) => (
    <Box maxWidth="320px" height="220px" position="relative">
      <SelectionActionBar {...args} />
    </Box>
  ),
};

function ClearRebuildsHeaderDemo() {
  const [selected, setSelected] = useState(2);
  return (
    <>
      <table id="rows" aria-label="rows">
        <thead>
          <tr>
            <th key={selected}>
              <input type="checkbox" data-select-all="" aria-label="Select all" />
            </th>
          </tr>
        </thead>
      </table>
      {selected > 0 && (
        <SelectionActionBar
          label={`${selected} selected`}
          placement="inline"
          forTable="rows"
          onClear={() => setSelected(0)}
        />
      )}
    </>
  );
}

/** Clearing replaces the header and unmounts the bar; focus lands on the new select-all. */
export const ClearRebuildsHeader: Story = { render: () => <ClearRebuildsHeaderDemo /> };
