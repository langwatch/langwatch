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
