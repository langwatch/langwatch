import { Box, Input, Textarea } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { VerticalFormControl } from "./vertical-form-control";

const meta = {
  title: "Components/Vertical form control",
  component: VerticalFormControl,
  tags: ["autodocs"],
  args: {
    label: "Prompt handle",
    helper: "How the software development kit calls this prompt.",
    children: <Input defaultValue="checkout/greeting" />,
  },
  argTypes: {
    children: { control: false },
    label: { control: "text" },
    helper: { control: "text" },
    size: { control: "inline-radio", options: ["sm", "md"] },
  },
  render: (args) => (
    <Box maxWidth="md">
      <VerticalFormControl {...args} />
    </Box>
  ),
} satisfies Meta<typeof VerticalFormControl>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Invalid: Story = {
  args: {
    invalid: true,
    error: { type: "manual", message: "Use lowercase letters, numbers, slashes and dashes." },
  },
};

export const Small: Story = {
  args: { size: "sm" },
};

export const Disabled: Story = {
  args: { children: <Input defaultValue="checkout/greeting" disabled /> },
};

export const WithTooltip: Story = {
  args: { tooltip: "Changing the handle breaks callers already using the old one." },
};

export const LongText: Story = {
  args: {
    label: "System prompt",
    helper: "Sent before every message in the conversation.",
    children: (
      <Textarea
        rows={4}
        defaultValue="You are a careful assistant. Answer only from the retrieved context and say so plainly when the context does not cover the question."
      />
    ),
  },
};

export const NarrowWidth: Story = {
  render: (args) => (
    <Box maxWidth="220px">
      <VerticalFormControl {...args} />
    </Box>
  ),
};
