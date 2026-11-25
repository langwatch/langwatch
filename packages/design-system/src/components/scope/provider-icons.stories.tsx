import type { Meta, StoryObj } from "@storybook/react-vite";

import { ProviderIcon } from "./provider-icons.tsx";

const meta = {
  title: "Data display/Provider icons",
  parameters: {
    usage: { use: "A model provider's mark.", avoid: "Product icons: see Foundations/Icons." },
  },
  component: ProviderIcon,
  tags: ["autodocs"],
  args: { model: "openai/gpt-5-mini", size: "comfortable" },
} satisfies Meta<typeof ProviderIcon>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Comfortable: Story = {};

export const Compact: Story = {
  args: { model: "anthropic/claude-sonnet-4", size: "compact" },
};
