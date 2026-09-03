import { Box } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { SegmentedControl } from "../../src/components/segmented-control";

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
