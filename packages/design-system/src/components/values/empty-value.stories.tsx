import { Table } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { EmptyValue } from "./empty-value.tsx";

const meta = {
  title: "Data display/Empty value",
  parameters: {
    usage: {
      use: "A value that is not there (no model, never run, no owner): an em dash in fg.subtle, read aloud as its label.",
      avoid:
        'N/A, -, null, undefined, "Default" or an empty cell. A whole list with nothing in it: Empty state.',
    },
  },
  component: EmptyValue,
  tags: ["autodocs"],
} satisfies Meta<typeof EmptyValue>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const InATable: Story = {
  render: () => (
    <Table.Root size="sm" maxWidth="360px">
      <Table.Body>
        <Table.Row>
          <Table.Cell>Last run</Table.Cell>
          <Table.Cell>
            <EmptyValue label="Never run" />
          </Table.Cell>
        </Table.Row>
      </Table.Body>
    </Table.Root>
  ),
};
