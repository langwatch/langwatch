import { HStack } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Switch } from "./switch";

const meta = {
  title: "Primitives/Switch",
  component: Switch,
  tags: ["autodocs"],
  args: { children: "Capture inputs and outputs" },
  argTypes: { trackLabel: { control: false }, thumbLabel: { control: false } },
} satisfies Meta<typeof Switch>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const On: Story = {
  args: { checked: true },
};

export const Disabled: Story = {
  args: { disabled: true, checked: true },
};

export const Invalid: Story = {
  args: { invalid: true },
};

export const Sizes: Story = {
  render: (args) => (
    <HStack gap="4" align="center">
      <Switch {...args} size="sm" />
      <Switch {...args} size="md" />
      <Switch {...args} size="lg" />
    </HStack>
  ),
};

/** A label on the track says which way is which without reading the row. */
export const WithTrackLabels: Story = {
  args: {
    trackLabel: { on: "On", off: "Off" },
    children: undefined,
    "aria-label": "Capture inputs and outputs",
  },
};

export const LongText: Story = {
  args: {
    children:
      "Redact personally identifiable information from every span before it leaves the browser",
    maxWidth: "280px",
  },
};
