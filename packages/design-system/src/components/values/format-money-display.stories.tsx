import { Stack } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { FormatMoney } from "./format-money-display.tsx";

const meta = {
  title: "Data display/Format money",
  parameters: {
    usage: {
      use: "Existing call sites only. New code uses Money: any currency, the reader's locale, sizes and tones.",
      avoid: "Any new screen: use Money. A plain number: use Formatted number.",
    },
  },
  component: FormatMoney,
  tags: ["autodocs"],
  args: {
    amount: 12.3456,
    currency: "USD",
  },
  argTypes: {
    currency: { control: "inline-radio", options: ["USD", "EUR"] },
  },
} satisfies Meta<typeof FormatMoney>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Euro: Story = {
  args: { currency: "EUR" },
};

export const WithTooltip: Story = {
  args: { tooltip: "Across 1,204 model calls this month" },
};

export const Amounts: Story = {
  render: (args) => (
    <Stack gap="1">
      <FormatMoney {...args} amount={0.00042} />
      <FormatMoney {...args} amount={3.5} />
      <FormatMoney {...args} amount={1520.75} format="$0,0.00" />
    </Stack>
  ),
};
