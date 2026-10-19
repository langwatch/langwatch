import { Tabs } from "@chakra-ui/react";
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

/** On a tab the hidden space makes the name "People 5" (zero: "People 0"; unknown: "People"). */
export const OnATab: Story = {
  render: () => (
    <Tabs.Root defaultValue="five" size="sm" variant="line">
      <Tabs.List aria-label="Counted tabs">
        {[
          { value: "five", label: "People", count: 5 },
          { value: "zero", label: "Teams", count: 0 },
          { value: "unknown", label: "Audit", count: undefined },
        ].map(({ value, label, count }) => (
          <Tabs.Trigger key={value} value={value}>
            {label}
            <TabCount value={count} />
          </Tabs.Trigger>
        ))}
      </Tabs.List>
    </Tabs.Root>
  ),
};
