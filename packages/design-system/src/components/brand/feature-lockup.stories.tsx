import { Stack } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { FeatureLockup } from "./feature-lockup.tsx";

const meta = {
  title: "Brand/Feature lockup",
  parameters: {
    usage: {
      use: "A branded feature's mark and name in the display face: a feature's landing page, empty state or docs hero.",
      avoid:
        "Page titles inside the product, which stay in Inter; restating the name in a heading right beside it.",
    },
  },
  component: FeatureLockup,
  tags: ["autodocs"],
  args: { feature: "braids" },
} satisfies Meta<typeof FeatureLockup>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** With the launch tagline under the name. */
export const WithTagline: Story = { args: { size: "lg", tagline: true } };

export const Mono: Story = { args: { variant: "mono" } };

export const Dark: Story = { args: { tagline: true, forceColorMode: "dark" } };

export const Sizes: Story = {
  render: (args) => (
    <Stack gap="6">
      {(["sm", "md", "lg"] as const).map((size) => (
        <FeatureLockup key={size} {...args} size={size} tagline />
      ))}
    </Stack>
  ),
};
