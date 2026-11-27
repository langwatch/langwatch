import { Box } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { FeatureIllustration } from "./feature-illustration.tsx";

const meta = {
  title: "Brand/Feature illustration",
  parameters: {
    usage: {
      use: "A branded feature's art: its empty state and its Enterprise upsell. Decorative; the copy beside it carries the meaning.",
      avoid: "Explaining something only in the art.",
    },
  },
  component: FeatureIllustration,
  tags: ["autodocs"],
  args: { feature: "braids", name: "empty-state" },
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

export const EmptyState: Story = {};

export const Enterprise: Story = { args: { name: "enterprise" } };

export const EnterpriseDark: Story = { args: { name: "enterprise", forceColorMode: "dark" } };
