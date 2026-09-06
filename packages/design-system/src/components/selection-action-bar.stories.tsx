import { Box, Button, HStack, Text } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { SelectionActionBar } from "./selection-action-bar.tsx";

const meta = {
  title: "Patterns/Selection action bar",
  component: SelectionActionBar,
  tags: ["autodocs"],
  args: {
    label: "3 traces selected",
    onClear: () => undefined,
  },
  argTypes: { children: { control: false }, label: { control: "text" } },
  parameters: { layout: "fullscreen" },
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
