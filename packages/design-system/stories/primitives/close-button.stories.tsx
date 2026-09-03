import { HStack } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { CloseButton } from "../../src/components/close-button";

const meta = {
  title: "Primitives/Close button",
  component: CloseButton,
  tags: ["autodocs"],
  args: {
    "aria-label": "Close panel",
  },
  argTypes: {
    children: { control: false },
  },
} satisfies Meta<typeof CloseButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Sizes: Story = {
  render: (args) => (
    <HStack gap="3">
      <CloseButton {...args} size="xs" />
      <CloseButton {...args} size="sm" />
      <CloseButton {...args} size="md" />
    </HStack>
  ),
};
