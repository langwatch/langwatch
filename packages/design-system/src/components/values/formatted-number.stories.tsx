import { HStack } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { FormattedNumber, NumberFormats } from "./formatted-number.tsx";

const meta = {
  title: "Data display/Formatted number",
  parameters: {
    usage: {
      use: "Any number a person reads: compact by default, every other format on hover.",
      avoid: "Money: use Format money. Never `toLocaleString` at the call site.",
    },
  },
  component: FormattedNumber,
  tags: ["autodocs"],
  args: { value: 1_234_567 },
} satisfies Meta<typeof FormattedNumber>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Currency: Story = { args: { value: 18_420.5, currency: "USD" } };

export const WithUnit: Story = { args: { value: 48_213, unit: "tokens" } };

export const Scales: Story = {
  render: () => (
    <HStack gap={6}>
      {[0, 7, 999, 12_400, 3_400_000, 9_100_000_000].map((value) => (
        <FormattedNumber key={value} value={value} />
      ))}
    </HStack>
  ),
};

/** What the hover shows. */
export const Formats: Story = {
  render: () => <NumberFormats value={1_234_567.891} unit="tokens" />,
};
