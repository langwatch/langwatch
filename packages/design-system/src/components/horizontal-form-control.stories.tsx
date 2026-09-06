import { Box, Input, Stack } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { HorizontalFormControl } from "./horizontal-form-control";

const meta = {
  title: "Components/Horizontal form control",
  component: HorizontalFormControl,
  tags: ["autodocs"],
  args: {
    label: "Project name",
    helper: "Shown in the project switcher and on every trace.",
    children: <Input defaultValue="Checkout assistant" />,
  },
  argTypes: {
    children: { control: false },
    label: { control: "text" },
    helper: { control: "text" },
    size: { control: "inline-radio", options: ["sm", "md"] },
  },
  render: (args) => (
    <Box maxWidth="lg">
      <HorizontalFormControl {...args} />
    </Box>
  ),
} satisfies Meta<typeof HorizontalFormControl>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithTooltip: Story = {
  args: { tooltip: "Renaming a project does not change the identifiers already sent." },
};

export const Invalid: Story = {
  args: {
    invalid: true,
    error: { type: "manual", message: "A project with this name already exists." },
  },
};

export const Small: Story = {
  args: { size: "sm" },
};

export const Disabled: Story = {
  args: { children: <Input defaultValue="Checkout assistant" disabled /> },
};

export const LongText: Story = {
  args: {
    label: "Default evaluation threshold for newly created monitors",
    helper:
      "Every monitor created from now on starts at this threshold. Existing monitors keep the threshold they were saved with.",
  },
};

export const Stacked: Story = {
  render: (args) => (
    <Stack maxWidth="lg">
      <HorizontalFormControl {...args} />
      <HorizontalFormControl label="Slug" helper="Used in the address bar.">
        <Input defaultValue="checkout-assistant" />
      </HorizontalFormControl>
    </Stack>
  ),
};

export const NarrowWidth: Story = {
  render: (args) => (
    <Box maxWidth="280px">
      <HorizontalFormControl {...args} />
    </Box>
  ),
};
