import type { Meta, StoryObj } from "@storybook/react-vite";

import { CopyButton } from "./copy-button.tsx";

const meta = {
  title: "Primitives/Copy button",
  component: CopyButton,
  tags: ["autodocs"],
  args: {
    value: "sk-lw-example-key",
    label: "API key",
  },
} satisfies Meta<typeof CopyButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const TraceId: Story = {
  args: { value: "trace_4f2a9c81d3", label: "Trace ID" },
};
