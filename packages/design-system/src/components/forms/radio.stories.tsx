import { Stack } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { Radio, RadioGroup } from "./radio.tsx";

const meta = {
  title: "Inputs and forms/Radio",
  parameters: {
    usage: {
      use: "One choice out of two to five options that should all stay visible.",
      avoid:
        "Six or more options, or options loaded from data: use Select. Switching a view: use Segmented control.",
    },
  },
  component: RadioGroup,
  tags: ["autodocs"],
  args: { defaultValue: "member" },
  render: (args) => (
    <RadioGroup {...args}>
      <Stack gap="2">
        <Radio value="admin">Administrator</Radio>
        <Radio value="member">Member</Radio>
        <Radio value="viewer">Viewer</Radio>
      </Stack>
    </RadioGroup>
  ),
} satisfies Meta<typeof RadioGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Disabled: Story = {
  args: { disabled: true },
};

export const WithADisabledOption: Story = {
  render: (args) => (
    <RadioGroup {...args}>
      <Stack gap="2">
        <Radio value="admin">Administrator</Radio>
        <Radio value="member">Member</Radio>
        <Radio value="viewer" disabled>
          Viewer (needs a paid seat)
        </Radio>
      </Stack>
    </RadioGroup>
  ),
};

export const LongText: Story = {
  render: (args) => (
    <RadioGroup {...args} maxWidth="280px">
      <Stack gap="2">
        <Radio value="member">
          Member, who can read and write every project in this organization
        </Radio>
        <Radio value="viewer">
          Viewer, who can read the projects they are invited to and change nothing
        </Radio>
      </Stack>
    </RadioGroup>
  ),
};
