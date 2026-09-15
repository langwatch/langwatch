import { HStack, Stack } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Checkbox, CheckboxGroup } from "./checkbox.tsx";

const meta = {
  title: "Primitives/Checkbox",
  component: Checkbox,
  tags: ["autodocs"],
  args: { children: "Include archived traces" },
  argTypes: { icon: { control: false } },
} satisfies Meta<typeof Checkbox>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Checked: Story = {
  args: { checked: true },
};

export const Indeterminate: Story = {
  args: { checked: "indeterminate" },
};

export const Disabled: Story = {
  args: { disabled: true },
};

export const Invalid: Story = {
  args: { invalid: true, children: "Accept the terms" },
};

export const WithoutLabel: Story = {
  args: { children: undefined, "aria-label": "Select row" },
};

export const Sizes: Story = {
  render: (args) => (
    <HStack gap="4" align="center">
      <Checkbox {...args} size="sm" />
      <Checkbox {...args} size="md" />
      <Checkbox {...args} size="lg" />
    </HStack>
  ),
};

export const LongText: Story = {
  args: {
    children:
      "Send an email whenever an evaluation on this monitor falls below the threshold for two consecutive runs",
  },
  render: (args) => (
    <Stack maxWidth="260px">
      <Checkbox {...args} />
    </Stack>
  ),
};

export const Group: Story = {
  render: () => (
    <CheckboxGroup defaultValue={["errors"]}>
      <Stack gap="2">
        <Checkbox value="errors">Errors</Checkbox>
        <Checkbox value="warnings">Warnings</Checkbox>
        <Checkbox value="info" disabled>
          Information
        </Checkbox>
      </Stack>
    </CheckboxGroup>
  ),
};
