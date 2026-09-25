import { HStack } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { BarChart3, MessageSquare } from "lucide-react";

import { AskChip } from "./ask-chip.tsx";

const meta = {
  title: "Components/Ask chip",
  component: AskChip,
  tags: ["autodocs"],
  args: {
    icon: <MessageSquare size={12} />,
    label: "Why did my costs go up this week?",
  },
  argTypes: {
    icon: { control: false },
  },
} satisfies Meta<typeof AskChip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Prompt: Story = {
  args: { onClick: () => undefined },
};

export const Link: Story = {
  args: { href: "#analytics", label: "Open the cost dashboard", icon: <BarChart3 size={12} /> },
};

export const Row: Story = {
  render: (args) => (
    <HStack gap="2">
      <AskChip {...args} />
      <AskChip {...args} label="Which traces failed today?" />
      <AskChip {...args} label="Show the slowest model" icon={<BarChart3 size={12} />} />
    </HStack>
  ),
};
