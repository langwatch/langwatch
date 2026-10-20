import { Box, Card, IconButton, Table, Text } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ChevronDown, ChevronRight, Database, MoreHorizontal } from "lucide-react";
import { Fragment, useState } from "react";

import { NoDataInfoBlock } from "../states/no-data-info-block.tsx";
import { EmptyValue } from "../values/empty-value.tsx";
import { ListTable, type SortDirection } from "./list-table.tsx";

const ROWS = [
  { name: "Checkout greeting", model: "gpt-5-mini", version: 12 },
  { name: "Support triage", model: "claude-opus-4", version: 3 },
  { name: "Refund policy answer", model: "gpt-5-mini", version: 8 },
];

const meta = {
  title: "Data display/List table",
  parameters: {
    usage: {
      use: 'Every list of rows: the rounded card and uppercase header are the one list look. Inside a Card or SettingsCard pass variant="embedded". Sortable columns: ListTable.SortHeader. Ids: ListTable.IdCell. Row menus: ListTable.ActionHeader + ListTable.ActionCell, pinned right. Loading: ListTable.LoadingRows. An opened row, an empty line or a note under the rows: ListTable.SpanRow. A wide table: scroll="x" with a scrollLabel (a focusable region); inside a virtual scroller: scroll="external".',
      avoid:
        "Never a bare Table.Root with its own borders (list-table.md), a header styled by hand, a Spinner row while loading, or a second border around an embedded table. Facts about one thing: use Settings card rows.",
    },
  },
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
        <ListTable.LoadingRows rows={3} columns={2} />
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

export const Compact: Story = { args: { density: "compact" } };

/** Inside a card the card draws the border: no second frame. */
export const Embedded: Story = {
  render: (args) => (
    <Card.Root bg="bg.card" borderColor="border.card" maxWidth="560px">
      <Card.Body padding={0}>
        <ListTable {...args} variant="embedded">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>Member</Table.ColumnHeader>
              <Table.ColumnHeader>Role</Table.ColumnHeader>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            <Table.Row>
              <Table.Cell>Ada Lovelace</Table.Cell>
              <Table.Cell>Admin</Table.Cell>
            </Table.Row>
            <Table.Row>
              <Table.Cell>Grace Hopper</Table.Cell>
              <Table.Cell>
                <EmptyValue label="No role" />
              </Table.Cell>
            </Table.Row>
          </Table.Body>
        </ListTable>
      </Card.Body>
    </Card.Root>
  ),
};

function SortableTable(args: Parameters<typeof ListTable>[0]) {
  const [sort, setSort] = useState<{ column: "name" | "version"; direction: SortDirection }>({
    column: "name",
    direction: "asc",
  });
  const toggle = (column: "name" | "version") =>
    setSort((current) => ({
      column,
      direction: current.column === column && current.direction === "asc" ? "desc" : "asc",
    }));
  const rows = ROWS.toSorted((a, b) => {
    const order = sort.column === "name" ? a.name.localeCompare(b.name) : a.version - b.version;
    return sort.direction === "asc" ? order : -order;
  });
  return (
    <ListTable {...args} containerProps={{ overflowX: "auto" }}>
      <Table.Header>
        <Table.Row>
          <ListTable.SortHeader
            sorted={sort.column === "name" && sort.direction}
            onSort={() => toggle("name")}
          >
            Prompt
          </ListTable.SortHeader>
          <Table.ColumnHeader>Prompt ID</Table.ColumnHeader>
          <ListTable.SortHeader
            align="end"
            sorted={sort.column === "version" && sort.direction}
            onSort={() => toggle("version")}
          >
            Version
          </ListTable.SortHeader>
          <ListTable.ActionHeader />
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {rows.map((row) => (
          <Table.Row key={row.name}>
            <Table.Cell>{row.name}</Table.Cell>
            <ListTable.IdCell
              value={`prompt_${row.name.length}x9KfQ2mZ7LrP4tV`}
              label="prompt ID"
            />
            <Table.Cell textAlign="end" fontVariantNumeric="tabular-nums">
              {row.version}
            </Table.Cell>
            <ListTable.ActionCell>
              <IconButton size="xs" variant="ghost" aria-label={`Actions for ${row.name}`}>
                <MoreHorizontal />
              </IconButton>
            </ListTable.ActionCell>
          </Table.Row>
        ))}
      </Table.Body>
    </ListTable>
  );
}

/** Sort headers, an id column and the pinned row-actions column. */
export const SortIdsAndActions: Story = { render: (args) => <SortableTable {...args} /> };

/** No rows: the inline empty state under the header, never a bare "No rows" line. */
export const EmptyInline: Story = {
  render: (args) => (
    <ListTable {...args}>
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeader>Dataset</Table.ColumnHeader>
          <Table.ColumnHeader>Entries</Table.ColumnHeader>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        <Table.Row _hover={{ bg: "transparent" }}>
          <Table.Cell colSpan={2} padding={0}>
            <NoDataInfoBlock
              size="inline"
              bordered={false}
              icon={<Database />}
              title="No datasets yet"
              description="Datasets hold the examples you evaluate a prompt against."
            />
          </Table.Cell>
        </Table.Row>
      </Table.Body>
    </ListTable>
  ),
};

export const LongTextAndNarrowWidth: Story = {
  render: (args) => (
    <Box maxWidth="320px">
      <ListTable {...args}>
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeader>Prompt</Table.ColumnHeader>
            <Table.ColumnHeader>Run plan</Table.ColumnHeader>
            <Table.ColumnHeader>Model</Table.ColumnHeader>
            <Table.ColumnHeader>Last updated</Table.ColumnHeader>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          <Table.Row>
            <Table.Cell>Refund policy answer for European Union customers</Table.Cell>
            <Table.Cell>Nightly regression</Table.Cell>
            <Table.Cell>claude-opus-4</Table.Cell>
            <Table.Cell>2 hours ago</Table.Cell>
          </Table.Row>
        </Table.Body>
      </ListTable>
    </Box>
  ),
};

function OpeningRows(args: Parameters<typeof ListTable>[0]) {
  const [opened, setOpened] = useState<string[]>([ROWS[0]?.name ?? ""]);
  const toggle = (name: string) =>
    setOpened((current) =>
      current.includes(name) ? current.filter((key) => key !== name) : [...current, name],
    );
  return (
    <ListTable {...args} tableLayout="fixed">
      <Table.ColumnGroup>
        <Table.Column width="44px" />
        <Table.Column />
        <Table.Column width="120px" />
      </Table.ColumnGroup>
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeader />
          <Table.ColumnHeader>Prompt</Table.ColumnHeader>
          <Table.ColumnHeader>Model</Table.ColumnHeader>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {ROWS.map((row) => {
          const isOpen = opened.includes(row.name);
          return (
            <Fragment key={row.name}>
              <Table.Row cursor="pointer" aria-expanded={isOpen} onClick={() => toggle(row.name)}>
                <Table.Cell color="fg.muted">
                  {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </Table.Cell>
                <Table.Cell>{row.name}</Table.Cell>
                <Table.Cell>{row.model}</Table.Cell>
              </Table.Row>
              {isOpen ? (
                <ListTable.SpanRow columns={3}>
                  <Box bg="bg.muted" paddingY={2} paddingLeft={14} paddingRight={4}>
                    <Text textStyle="sm" color="fg.muted">
                      Version {row.version}, published by the team.
                    </Text>
                  </Box>
                </ListTable.SpanRow>
              ) : null}
            </Fragment>
          );
        })}
        <ListTable.SpanRow columns={3}>
          <Text textStyle="xs" color="fg.muted" paddingX={4} paddingY={2}>
            Showing the newest 3 prompts.
          </Text>
        </ListTable.SpanRow>
      </Table.Body>
    </ListTable>
  );
}

/** Rows that open in place, and a note under the rows: ListTable.SpanRow spans every column. */
export const OpenedRowsAndNote: Story = { render: (args) => <OpeningRows {...args} /> };

const WIDE_COLUMNS = ["Request", "Model", "Route", "Latency", "Tokens in", "Tokens out", "Cost"];

function wideRows() {
  return (
    <>
      <Table.Header>
        <Table.Row>
          {WIDE_COLUMNS.map((name) => (
            <Table.ColumnHeader key={name} width="8rem">
              {name}
            </Table.ColumnHeader>
          ))}
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {ROWS.map((row) => (
          <Table.Row key={row.name}>
            <Table.Cell>{row.name}</Table.Cell>
            <Table.Cell>{row.model}</Table.Cell>
            {WIDE_COLUMNS.slice(2).map((name) => (
              <Table.Cell key={name}>{row.version}</Table.Cell>
            ))}
          </Table.Row>
        ))}
      </Table.Body>
    </>
  );
}

const wideX = (
  <ListTable scroll="x" scrollLabel="Billing events" tableLayout="fixed" minWidth="56rem">
    {wideRows()}
  </ListTable>
);

/** Wider than its parent: the table scrolls inside a focusable region named by `scrollLabel`. */
export const ScrollsSideways: Story = {
  render: () => <Box maxWidth="40rem">{wideX}</Box>,
};

/** An outer scroller owns scrolling (a virtual list): the table never clips its header. */
export const ExternalScroll: Story = {
  render: () => (
    <Box maxWidth="40rem" maxHeight="9rem" overflow="auto">
      <ListTable scroll="external" stickyHeader tableLayout="fixed" minWidth="56rem">
        {wideRows()}
      </ListTable>
    </Box>
  ),
};

export const NarrowScroll: Story = {
  render: () => <Box maxWidth="320px">{wideX}</Box>,
};

/** Columns with no width size to their content; mix px, percentage and unsized. */
export const AutomaticColumns: Story = {
  render: () => (
    <ListTable aria-label="Mixed widths">
      <ListTable.ColumnGroup>
        <ListTable.Column />
        <ListTable.Column width="30%" />
        <ListTable.Column width={120} />
      </ListTable.ColumnGroup>
      <ListTable.Header>
        <ListTable.Row>
          <ListTable.ColumnHeader>Name</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>Share</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>Count</ListTable.ColumnHeader>
        </ListTable.Row>
      </ListTable.Header>
    </ListTable>
  ),
};

/** A tall header grows with wrapped summaries instead of clipping them. */
export const ContentHeader: Story = {
  render: () => (
    <ListTable aria-label="Wrapped headers" headerLayout="content">
      <ListTable.Header>
        <ListTable.Row>
          <ListTable.ColumnHeader>
            A long column summary that wraps onto a second and third line when the column is narrow
          </ListTable.ColumnHeader>
          <ListTable.ColumnHeader>Pass rate</ListTable.ColumnHeader>
        </ListTable.Row>
      </ListTable.Header>
    </ListTable>
  ),
};
