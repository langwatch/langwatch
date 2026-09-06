import { Box, Stack } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { SegmentedControl } from "./segmented-control.tsx";

const meta = {
  title: "Components/Segmented control",
  component: SegmentedControl,
  tags: ["autodocs"],
  args: {
    defaultValue: "all",
    items: [
      { value: "all", label: "All" },
      { value: "active", label: "Active" },
      { value: "archived", label: "Archived" },
    ],
  },
  argTypes: {
    items: { control: false },
  },
  render: (args) => (
    <Box maxWidth="sm">
      <SegmentedControl {...args} />
    </Box>
  ),
} satisfies Meta<typeof SegmentedControl>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithDisabledItem: Story = {
  args: {
    items: [
      { value: "all", label: "All" },
      { value: "active", label: "Active" },
      { value: "archived", label: "Archived", disabled: true },
    ],
  },
};

export const Disabled: Story = {
  args: { disabled: true },
};

export const Sizes: Story = {
  render: (args) => (
    <Stack gap="3" align="start">
      <SegmentedControl {...args} size="xs" />
      <SegmentedControl {...args} size="sm" />
      <SegmentedControl {...args} size="md" />
      <SegmentedControl {...args} size="lg" />
    </Stack>
  ),
};

export const LongText: Story = {
  args: {
    items: [
      { value: "day", label: "Last twenty four hours" },
      { value: "week", label: "Last seven days" },
      { value: "month", label: "Last thirty days" },
    ],
  },
};

export const NarrowWidth: Story = {
  render: (args) => (
    <Box maxWidth="180px">
      <SegmentedControl {...args} />
    </Box>
  ),
};
