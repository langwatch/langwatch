import { Box, Stack } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { SimpleSlider } from "./slider";

const meta = {
  title: "Primitives/Slider",
  component: SimpleSlider,
  tags: ["autodocs"],
  args: {
    defaultValue: [0.7],
    min: 0,
    max: 2,
    step: 0.1,
    label: "Temperature",
  },
  argTypes: { marks: { control: false }, label: { control: "text" } },
  render: (args) => (
    <Box maxWidth="sm">
      <SimpleSlider {...args} />
    </Box>
  ),
} satisfies Meta<typeof SimpleSlider>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithValueShown: Story = {
  args: { showValue: true },
};

export const WithMarks: Story = {
  args: {
    marks: [
      { value: 0, label: "0" },
      { value: 1, label: "1" },
      { value: 2, label: "2" },
    ],
  },
};

export const Range: Story = {
  args: { defaultValue: [0.2, 1.4] },
};

export const Disabled: Story = {
  args: { disabled: true },
};

export const Sizes: Story = {
  render: (args) => (
    <Stack gap="6" maxWidth="sm">
      <SimpleSlider {...args} size="sm" />
      <SimpleSlider {...args} size="md" />
      <SimpleSlider {...args} size="lg" />
    </Stack>
  ),
};

export const NarrowWidth: Story = {
  render: (args) => (
    <Box maxWidth="140px">
      <SimpleSlider {...args} />
    </Box>
  ),
};
