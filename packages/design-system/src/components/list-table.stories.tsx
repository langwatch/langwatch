import { Box, Skeleton, Table, Text } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ListTable } from "./list-table.tsx";

const ROWS = [
  { name: "Checkout greeting", model: "gpt-5-mini", version: 12 },
  { name: "Support triage", model: "claude-opus-4", version: 3 },
  { name: "Refund policy answer", model: "gpt-5-mini", version: 8 },
];

const meta = {
  title: "Components/List table",
  component: ListTable,
  tags: ["autodocs"],
  argTypes: { children: { control: false }, containerProps: { control: false } },
  render: (args) => (
    <ListTable {...args}>
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeader>Prompt</Table.ColumnHeader>
          <Table.ColumnHeader>Model</Table.ColumnHeader>
          <Table.ColumnHeader>Version</Table.ColumnHeader>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {ROWS.map((row) => (
          <Table.Row key={row.name}>
            <Table.Cell>{row.name}</Table.Cell>
            <Table.Cell>{row.model}</Table.Cell>
            <Table.Cell>{row.version}</Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </ListTable>
  ),
} satisfies Meta<typeof ListTable>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Loading: Story = {
  render: (args) => (
    <ListTable {...args}>
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeader>Prompt</Table.ColumnHeader>
          <Table.ColumnHeader>Model</Table.ColumnHeader>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {[0, 1, 2].map((row) => (
          <Table.Row key={row}>
            <Table.Cell>
              <Skeleton height="14px" width="180px" />
            </Table.Cell>
            <Table.Cell>
              <Skeleton height="14px" width="90px" />
            </Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </ListTable>
  ),
};

export const Empty: Story = {
  render: (args) => (
    <ListTable {...args}>
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeader>Prompt</Table.ColumnHeader>
          <Table.ColumnHeader>Model</Table.ColumnHeader>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        <Table.Row>
          <Table.Cell colSpan={2}>
            <Text textStyle="sm" color="fg.muted">
              No prompts yet.
            </Text>
          </Table.Cell>
        </Table.Row>
      </Table.Body>
    </ListTable>
  ),
};

export const Sizes: Story = {
  args: { size: "sm" },
};

export const LongTextAndNarrowWidth: Story = {
  render: (args) => (
    <Box maxWidth="260px">
      <ListTable {...args} containerProps={{ overflowX: "auto" }}>
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeader>Prompt</Table.ColumnHeader>
            <Table.ColumnHeader>Model</Table.ColumnHeader>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          <Table.Row>
            <Table.Cell>Refund policy answer for European Union customers</Table.Cell>
            <Table.Cell>claude-opus-4</Table.Cell>
          </Table.Row>
        </Table.Body>
      </ListTable>
    </Box>
  ),
};
