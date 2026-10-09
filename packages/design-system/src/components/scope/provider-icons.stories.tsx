import type { Meta, StoryObj } from "@storybook/react-vite";

import { ProviderIcon } from "./provider-icons.tsx";

const meta = {
  title: "Components/Provider icon",
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
