import { HStack, Stack, Text } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { PassRateCircle, PassRateDisplay } from "./pass-rate-indicator";

const RATES = [0, 25, 50, 75, 100];

const meta = {
  title: "Components/Pass rate indicator",
  component: PassRateDisplay,
  tags: ["autodocs"],
  args: { passRate: 82 },
  argTypes: {
    passRate: { control: { type: "range", min: 0, max: 100, step: 1 } },
  },
} satisfies Meta<typeof PassRateDisplay>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** Nothing has run yet, so there is no rate to colour. */
export const NoRuns: Story = {
  args: { passRate: null },
};

export const Failing: Story = {
  args: { passRate: 12 },
};

export const Scale: Story = {
  render: (args) => (
    <Stack gap="2">
      {RATES.map((rate) => (
        <HStack key={rate} gap="3">
          <PassRateDisplay {...args} passRate={rate} />
          <Text textStyle="xs" color="fg.muted">
            {rate} percent
          </Text>
        </HStack>
      ))}
    </Stack>
  ),
};

/** The circle alone, for a cell that has no room for the number. */
export const CircleOnly: Story = {
  render: (args) => (
    <HStack gap="3">
      {RATES.map((rate) => (
        <PassRateCircle key={rate} passRate={rate} size={args.circleSize} />
      ))}
      <PassRateCircle passRate={null} />
    </HStack>
  ),
};

export const Sizes: Story = {
  render: (args) => (
    <HStack gap="4" align="center">
      <PassRateDisplay {...args} circleSize="8px" fontSize="11px" />
      <PassRateDisplay {...args} />
      <PassRateDisplay {...args} circleSize="14px" fontSize="16px" />
    </HStack>
  ),
};

/** Colouring the number too is optional: a dense table often reads better without. */
export const PlainText: Story = {
  args: { showColoredText: false },
};
