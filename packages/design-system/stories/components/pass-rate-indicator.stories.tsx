import { Stack } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { PassRateDisplay } from "../../src/components/pass-rate-indicator";

const meta = {
  title: "Components/Pass rate indicator",
  component: PassRateDisplay,
  tags: ["autodocs"],
  args: {
    passRate: 82,
  },
} satisfies Meta<typeof PassRateDisplay>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const States: Story = {
  render: () => (
    <Stack align="flex-start" gap="3">
      <PassRateDisplay passRate={0} />
      <PassRateDisplay passRate={50} />
      <PassRateDisplay passRate={100} />
      <PassRateDisplay passRate={null} />
    </Stack>
  ),
};
