import { Stack, Text } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { HighlightedExpression } from "./highlighted-expression.tsx";

const meta = {
  title: "Data display/Highlighted expression",
  parameters: {
    usage: {
      use: 'A filter expression shown read-only, such as a braid condition: attributes["k"] == "v".',
      avoid:
        "A plain identifier: use Inline code. Several lines of a real language: use Code preview.",
    },
  },
  component: HighlightedExpression,
  tags: ["autodocs"],
  args: { code: 'attributes["orchestrator"] == "web" and Verified("orchestrator")' },
} satisfies Meta<typeof HighlightedExpression>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const EveryPart: Story = {
  args: { code: 'name == "checkout" or not attributes["retries"] != nil and 3 >= 2' },
};

/** A table cell: one line, cut at the end, the whole expression in the title. */
export const LongText: Story = {
  args: {
    code: 'attributes["orchestrator"] == "web" and attributes["tenant.region"] == "eu-central-1"',
    maxWidth: "240px",
  },
};

/** Unfinished text still colours, so a half-typed condition reads as it is. */
export const Unfinished: Story = { args: { code: 'attributes["orch' } };

/** Inside a sentence, a long expression wraps between its words. */
export const InASentence: Story = {
  render: () => (
    <Stack maxWidth="360px">
      <Text textStyle="sm">
        Shown because it matches{" "}
        <HighlightedExpression
          layout="wrap"
          code={'attributes["orchestrator"] == "web" and Verified("orchestrator")'}
        />
        .
      </Text>
    </Stack>
  ),
};

/** On its own lines in a table cell or a list: wraps between words, cut after two lines. */
export const Block: Story = {
  args: {
    layout: "block",
    maxLines: 2,
    code: 'attributes["orchestrator"] == "web" and attributes["tenant.region"] == "eu-central-1" and attributes["tier"] == "gold"',
    maxWidth: "280px",
  },
};

/** Narrow: a block wraps rather than cutting the only part that tells two conditions apart. */
export const BlockNarrow: Story = {
  args: { layout: "block", code: 'attributes["orchestrator"] == "web"', maxWidth: "140px" },
};
