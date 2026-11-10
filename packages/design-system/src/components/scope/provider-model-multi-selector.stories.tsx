import type { Meta, StoryObj } from "@storybook/react-vite";

import { ProviderModelMultiSelector } from "./provider-model-multi-selector.tsx";

const meta = {
  title: "Inputs and forms/Provider model multi-selector",
  parameters: {
    usage: {
      use: "Choosing several models from the configured providers, such as an allowlist.",
      avoid: "Picking one model: use Provider model selector.",
    },
  },
  component: ProviderModelMultiSelector,
  tags: ["autodocs"],
  args: {
    models: ["openai/gpt-5-mini"],
    emptyLabel: "Every model",
    onChange: () => void 0,
    query: {
      isLoading: false,
      data: [
        { label: "gpt-5-mini", value: "openai/gpt-5-mini" },
        { label: "gpt-5", value: "openai/gpt-5" },
        { label: "claude-sonnet-4", value: "anthropic/claude-sonnet-4" },
      ],
    },
  },
} satisfies Meta<typeof ProviderModelMultiSelector>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Picked: Story = {};

export const NothingPicked: Story = { args: { models: [] } };

export const PickedModelNoLongerOffered: Story = {
  args: { models: ["openai/gpt-5-mini", "mistral/mistral-large"] },
};
