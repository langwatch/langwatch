import type { Meta, StoryObj } from "@storybook/react-vite";

import { TabCount } from "./tab-count.tsx";

const meta = {
  title: "Data display/Tab count",
  parameters: {
    usage: {
      use: "The count beside a tab label, said the same way on every tab.",
      avoid: "A count anywhere else: Badge from primitives.",
    },
  },
  component: TabCount,
  tags: ["autodocs"],
  args: { value: 34 },
} satisfies Meta<typeof TabCount>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Zero: Story = { args: { value: 0 } };

export const Loading: Story = { args: { value: undefined } };
