import { Flex } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { EnterprisePill } from "./enterprise-pill.tsx";

const meta = {
  title: "Brand/Enterprise pill",
  parameters: {
    usage: {
      use: "Beside the title of a page or control a feature gates to Enterprise. See docs/feature-branding.md.",
      avoid:
        "A refusal or an error; the plan comparison table; a control the plan already carries.",
    },
  },
  component: EnterprisePill,
  tags: ["autodocs"],
  args: { feature: "braids" },
} satisfies Meta<typeof EnterprisePill>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A branded feature's pill: its mark in one colour beside the word. */
export const Default: Story = {};

/** A gated control with no feature brand of its own. */
export const WordOnly: Story = { args: { feature: undefined } };

export const Sizes: Story = {
  render: (args) => (
    <Flex align="center" gap="4">
      {(["xs", "sm", "md"] as const).map((size) => (
        <EnterprisePill key={size} {...args} size={size} />
      ))}
    </Flex>
  ),
};
