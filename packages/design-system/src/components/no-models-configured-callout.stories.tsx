import type { Meta, StoryObj } from "@storybook/react-vite";

import { NoModelsConfiguredCallout } from "./no-models-configured-callout.tsx";

const meta = {
  title: "Components/No models configured callout",
  component: NoModelsConfiguredCallout,
  tags: ["autodocs"],
} satisfies Meta<typeof NoModelsConfiguredCallout>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const ForAFeature: Story = {
  args: { forFeatureLabel: "evaluators", size: "sm" },
};
