import type { Meta, StoryObj } from "@storybook/react-vite";

import { NoModelsConfiguredCallout } from "./no-models-configured-callout.tsx";

const meta = {
  title: "Feedback/No models configured callout",
  parameters: { usage: { use: "Wherever a model is needed and no provider is configured yet." } },
  component: NoModelsConfiguredCallout,
  tags: ["autodocs"],
} satisfies Meta<typeof NoModelsConfiguredCallout>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const ForAFeature: Story = {
  args: { forFeatureLabel: "evaluators", size: "sm" },
};
