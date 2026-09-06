import { HStack, Stack, Text } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { MeterBar } from "./meter-bar";

const meta = {
  title: "Components/Meter bar",
  component: MeterBar,
  tags: ["autodocs"],
  args: {
    fillRatio: 0.4,
    width: "120px",
    height: "6px",
    fillColor: "blue.solid",
  },
  argTypes: {
    fillRatio: { control: { type: "range", min: 0, max: 1.2, step: 0.05 } },
    align: { control: "inline-radio", options: ["start", "end"] },
  },
} satisfies Meta<typeof MeterBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** No reading taken yet: a track with no fill says something different from zero. */
export const NoReading: Story = {
  args: { fillRatio: null },
};

export const Empty: Story = {
  args: { fillRatio: 0 },
};

/** Anything past the width it is measured in clamps to a full track. */
export const OverFull: Story = {
  args: { fillRatio: 1.6, fillColor: "red.solid" },
};

export const Alignments: Story = {
  render: (args) => (
    <Stack gap="3">
      <HStack gap="3">
        <Text textStyle="xs" width="60px">
          start
        </Text>
        <MeterBar {...args} align="start" />
      </HStack>
      <HStack gap="3">
        <Text textStyle="xs" width="60px">
          end
        </Text>
        <MeterBar {...args} align="end" />
      </HStack>
    </Stack>
  ),
};

export const NarrowWidth: Story = {
  args: { width: "36px" },
};
