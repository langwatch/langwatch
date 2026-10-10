import { Badge, Box, Button, HStack, Table } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Users } from "lucide-react";

import { SearchInput } from "../forms/search-input.tsx";
import { NoDataInfoBlock } from "../states/no-data-info-block.tsx";
import { FilterChips } from "./filter-chips.tsx";
import { ListPage, ListPageError } from "./list-page.tsx";
import { ListTable } from "./list-table.tsx";

const meta = {
  title: "Navigation and layout/List page",
  component: ListPage,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    usage: {
      use: "A resource list with a shared page header, filter/search toolbar, loading and error states, and Pagination. Supply columns with ListTable; keep queries and permissions in the feature.",
      avoid:
        "A dashboard of figures or an editor with independently scrolling panes: compose PageLayout directly.",
    },
  },
  args: {
    title: "Operators",
    subtitle: "People who can manage this installation.",
    actions: <Button size="sm">Grant access</Button>,
    toolbar: (
      <HStack wrap="wrap" gap={3}>
        <FilterChips
          groupLabel="Filter operators"
          value="all"
          onChange={() => void 0}
          items={[{ value: "all", label: "All", count: 1 }]}
        />
        <SearchInput placeholder="Search operators" />
      </HStack>
    ),
    children: (
      <ListTable>
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeader>Person</Table.ColumnHeader>
            <Table.ColumnHeader>Access</Table.ColumnHeader>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          <Table.Row>
            <Table.Cell>Alex Morgan</Table.Cell>
            <Table.Cell>
              <Badge colorPalette="green">Active</Badge>
            </Table.Cell>
          </Table.Row>
        </Table.Body>
      </ListTable>
    ),
    pagination: {
      page: 1,
      pageSize: 25,
      totalCount: 1,
      unitLabel: "operators",
      onPageChange: () => void 0,
    },
  },
} satisfies Meta<typeof ListPage>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const Loading: Story = { args: { loading: true } };
export const Refreshing: Story = { args: { refreshing: true } };
export const Empty: Story = {
  args: {
    empty: (
      <NoDataInfoBlock
        icon={<Users />}
        title="No matching operators"
        description="Try a different name or email address."
      />
    ),
  },
};
export const Failed: Story = {
  args: {
    error: <ListPageError title="Operators could not load">Try again in a moment.</ListPageError>,
  },
};
export const LongTitle: Story = {
  args: {
    title:
      "Operators responsible for the Europe production installation and its connected projects",
  },
};
export const Narrow: Story = {
  decorators: [
    (Story) => (
      <Box maxWidth="360px">
        <Story />
      </Box>
    ),
  ],
};
