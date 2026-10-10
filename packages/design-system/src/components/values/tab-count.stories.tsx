import type { Meta, StoryObj } from "@storybook/react-vite";

import { TabCount } from "./tab-count.tsx";

const meta = {
  title: "Primitives/TabCount",
  component: TabCount,
  tags: ["autodocs"],
  args: { value: 34 },
} satisfies Meta<typeof TabCount>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Zero: Story = { args: { value: 0 } };

export const Loading: Story = { args: { value: undefined } };
