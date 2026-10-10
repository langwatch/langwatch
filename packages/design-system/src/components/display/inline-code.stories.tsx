import { Badge, HStack, Table, Text } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { InlineCode } from "./inline-code.tsx";

const meta = {
  title: "Data display/Inline code",
  parameters: {
    usage: {
      use: "A key, path, command or identifier inside a sentence.",
      avoid: "Several lines: use Code preview.",
    },
  },
  component: InlineCode,
  tags: ["autodocs"],
  args: { children: "gateway.virtual_key.created" },
} satisfies Meta<typeof InlineCode>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Glob: Story = { args: { children: "gateway.*" } };

export const LongText: Story = {
  args: {
    children: "gateway.virtual_key.guardrail_attached.with_a_very_long_identifier_name",
    maxWidth: "200px",
  },
};

/** Ids, hashes, keys and paths keep both ends: the cut goes in the middle. */
export const TruncateMiddle: Story = {
  args: {
    children: "trace_01J9ZK3Q8W7E6R5T4Y3U2I1O0P",
    truncate: "middle",
    maxWidth: "180px",
  },
};

/** A path keeps its last segment whole. */
export const TruncateMiddlePath: Story = {
  args: {
    children: "modules/trace/browser/src/ui/sections/explorer/trace-drawer-layout.tsx",
    truncate: "middle",
    maxWidth: "260px",
  },
};

/** End or middle, side by side, at the same width. Click either: the whole value selects. */
export const TruncateModes: Story = {
  render: () => (
    <Table.Root size="sm" width="420px">
      <Table.Body>
        {(["end", "middle"] as const).map((truncate) => (
          <Table.Row key={truncate}>
            <Table.Cell width="80px">
              <Text textStyle="xs">{truncate}</Text>
            </Table.Cell>
            <Table.Cell>
              <InlineCode truncate={truncate} maxWidth="220px">
                sk-lw-9f8e7d6c5b4a3210fedcba9876543210
              </InlineCode>
            </Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </Table.Root>
  ),
};

/** Opting out of select-on-click, for text a reader picks words from. */
export const FreeSelection: Story = { args: { selectOnClick: false } };

export const InContexts: Story = {
  render: () => (
    <>
      <Text>
        Set <InlineCode>LANGWATCH_API_KEY</InlineCode> before running.
      </Text>
      <HStack>
        <Badge>
          <InlineCode>ops:view</InlineCode>
        </Badge>
      </HStack>
      <Table.Root size="sm">
        <Table.Body>
          <Table.Row>
            <Table.Cell>
              <InlineCode>gateway.*</InlineCode>
            </Table.Cell>
          </Table.Row>
        </Table.Body>
      </Table.Root>
    </>
  ),
};
