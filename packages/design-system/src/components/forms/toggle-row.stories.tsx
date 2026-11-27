import { Box, Button } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { Switch } from "./switch.tsx";
import { ToggleRow } from "./toggle-row.tsx";

const meta = {
  title: "Inputs and forms/Toggle row",
  parameters: {
    usage: {
      use: "One on/off setting that stands alone, in a dialog or on a page: a bordered row with the switch at its end.",
      avoid:
        "A run of settings in a settings section: use Settings field. A switch that needs a Save: switches save on change.",
    },
  },
  component: ToggleRow,
  tags: ["autodocs"],
  args: {
    label: "Only signed calls",
    hint: "Show spans only when the other project really made the call.",
    children: <Switch aria-label="Only signed calls" />,
  },
  argTypes: { children: { control: false } },
} satisfies Meta<typeof ToggleRow>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Off: Story = {};

export const On: Story = {
  args: { on: true, children: <Switch aria-label="Only signed calls" defaultChecked /> },
};

export const Disabled: Story = {
  args: { children: <Switch aria-label="Only signed calls" disabled /> },
};

/** Where the setting is not offered, the reason's action stands in the switch's place. */
export const NotOffered: Story = {
  args: {
    label: "Keep braids to organisation admins",
    hint: "Choosing who may braid is included in Enterprise.",
    children: (
      <Button size="xs" colorPalette="orange">
        See plans
      </Button>
    ),
  },
};

export const LongText: Story = {
  args: {
    label: "Keep braids to organisation admins, so that only they can create, change or remove one",
    hint: "While this is off, project admins can braid their projects. Turn it on and only organisation admins can.",
  },
};

export const Narrow: Story = {
  render: (args) => (
    <Box maxWidth="280px">
      <ToggleRow {...args} />
    </Box>
  ),
};
