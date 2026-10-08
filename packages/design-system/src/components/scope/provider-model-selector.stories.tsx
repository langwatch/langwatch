import type { Meta, StoryObj } from "@storybook/react-vite";

import { ProviderModelSelector } from "./provider-model-selector.tsx";

const meta = {
  title: "Components/Provider model selector",
  component: ProviderModelSelector,
  tags: ["autodocs"],
  args: {
    model: "openai/gpt-5-mini",
    onChange: () => void 0,
    query: {
      isLoading: false,
      data: [
        { label: "gpt-5-mini", value: "openai/gpt-5-mini" },
        { label: "claude-sonnet-4", value: "anthropic/claude-sonnet-4" },
      ],
    },
  },
} satisfies Meta<typeof ProviderModelSelector>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Selected: Story = {};

export const WithInherit: Story = {
  args: { model: "", inheritOption: { label: "Inherit (from organization)" } },
};
