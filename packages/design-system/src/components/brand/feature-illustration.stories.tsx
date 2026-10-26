import { Box } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { FeatureIllustration } from "./feature-illustration.tsx";

const meta = {
  title: "Brand/Feature illustration",
  parameters: {
    usage: {
      use: "A branded feature's art: its empty state, its Enterprise upsell and its docs or landing hero. Decorative; the copy beside it carries the meaning.",
      avoid: "Explaining something only in the art; replaying the hero on every render.",
    },
  },
  component: FeatureIllustration,
  tags: ["autodocs"],
  args: { feature: "braids", name: "hero" },
  decorators: [
    (Story) => (
      <Box maxWidth="760px">
        <Story />
      </Box>
    ),
  ],
} satisfies Meta<typeof FeatureIllustration>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Each project's strand weaves in once and lands on its spans; still under reduced motion. */
export const Hero: Story = {};

export const HeroStill: Story = { args: { animate: false } };

export const EmptyState: Story = { args: { name: "empty-state" } };

export const Enterprise: Story = { args: { name: "enterprise" } };

export const EnterpriseDark: Story = { args: { name: "enterprise", forceColorMode: "dark" } };
