import { HStack } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { Kbd } from "./kbd.tsx";

const meta = {
  title: "Primitives/Kbd",
  component: Kbd,
  tags: ["autodocs"],
  args: {
    children: "K",
  },
} satisfies Meta<typeof Kbd>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Demo: Story = {
  args: { demo: true, demoFirstDelayMs: 500 },
};

export const Shortcut: Story = {
  render: (args) => (
    <HStack gap="1">
      <Kbd {...args}>⌘</Kbd>
      <Kbd {...args}>K</Kbd>
    </HStack>
  ),
};
