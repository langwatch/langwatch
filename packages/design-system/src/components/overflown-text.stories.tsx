import { Box } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { OverflownTextWithTooltip } from "./overflown-text";

const LONG =
  "You are a careful assistant. Answer only from the retrieved context and say so plainly when the context does not cover the question.";

const meta = {
  title: "Components/Overflown text",
  component: OverflownTextWithTooltip,
  tags: ["autodocs"],
  args: { children: LONG },
  render: (args) => (
    <Box
      maxWidth="320px"
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="md"
      padding="2"
    >
      <OverflownTextWithTooltip {...args} />
    </Box>
  ),
} satisfies Meta<typeof OverflownTextWithTooltip>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Clipped to one line, and the full value is behind the tooltip. */
export const Default: Story = {};

/** Short enough to fit: no tooltip, because there is nothing hidden. */
export const FitsOnOneLine: Story = {
  args: { children: "gpt-5-mini" },
};

export const ThreeLines: Story = {
  args: { lineClamp: 3 },
};

export const NarrowWidth: Story = {
  render: (args) => (
    <Box
      maxWidth="120px"
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="md"
      padding="2"
    >
      <OverflownTextWithTooltip {...args} />
    </Box>
  ),
};

/** The tooltip can say something other than the clipped value. */
export const WithOwnLabel: Story = {
  args: { label: "The full system prompt, as it was sent." },
};
