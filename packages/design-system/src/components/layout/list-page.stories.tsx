import { Badge, Box, Button, Table } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Users } from "lucide-react";

import { FilterChips } from "./filter-chips.tsx";
import { ListPage } from "./list-page.tsx";
import { ListTable } from "./list-table.tsx";

const rows = (
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
);

const meta = {
  title: "Navigation and layout/List page",
  component: ListPage,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    usage: {
      use: "A resource list: header, description, search and filters, then one of five states (loading, error, empty, no-results, ready) that the caller derives from its read. Offset tables take pagination, append feeds take loadMore; never both.",
      avoid:
        "A dashboard of figures or an editor with independently scrolling panes: compose PageLayout directly. A drawer's list takes LoadMore alone.",
    },
  },
  args: {
    title: "Operators",
    description: "People who can manage this installation.",
    state: "ready",
    actions: <Button size="sm">Grant access</Button>,
    toolbar: {
      search: {
        value: "",
        onChange: () => void 0,
        placeholder: "Search operators",
        ariaLabel: "Search operators",
        testId: "operators-search",
      },
      filters: (
        <FilterChips
          groupLabel="Filter operators"
          value="all"
          onChange={() => void 0}
          items={[{ value: "all", label: "All", count: 1 }]}
        />
      ),
    },
    children: rows,
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

export const Ready: Story = {};
export const Loading: Story = { args: { state: "loading" } };
/** The rows stay while a refetch runs; a status line says so. */
export const Refreshing: Story = { args: { refreshing: true } };
export const Empty: Story = {
  args: {
    state: "empty",
    empty: {
      icon: <Users />,
      title: "No operators yet",
      description: "Grant access to the first person who runs this installation.",
      next: [{ kind: "docs", label: "Read how access works", href: "https://langwatch.ai/docs" }],
      primaryAction: <Button size="sm">Grant access</Button>,
    },
  },
};
/** Empty, pointing at the setting that turns it on. */
export const EmptyWithSetting: Story = {
  args: {
    state: "empty",
    empty: {
      icon: <Users />,
      title: "No operators yet",
      description: "Grant access to the first person who runs this installation.",
      next: [{ kind: "setting", label: "Open operator settings", href: "/settings/operators" }],
    },
  },
};
/** Empty, pointing at the docs page that explains it. */
export const EmptyWithDocs: Story = {
  args: {
    state: "empty",
    empty: {
      icon: <Users />,
      title: "No operators yet",
      description: "Grant access to the first person who runs this installation.",
      next: [{ kind: "docs", label: "Read how operators work", href: "https://langwatch.ai/docs" }],
    },
  },
};
/** Empty, offering a prompt to paste into a coding agent. */
export const EmptyWithAgentPrompt: Story = {
  args: {
    state: "empty",
    empty: {
      icon: <Users />,
      title: "No operators yet",
      description: "Grant access to the first person who runs this installation.",
      next: [
        {
          kind: "agent-prompt",
          prompt: "Add LangWatch tracing to this project and grant me operator access.",
        },
      ],
    },
  },
};

/** Records exist but the filters matched none; the toolbar stays so they can be cleared. */
export const NoResults: Story = {
  args: {
    state: "no-results",
    toolbar: {
      search: {
        value: "zed",
        onChange: () => void 0,
        placeholder: "Search operators",
        ariaLabel: "Search operators",
      },
    },
    noResults: {
      description: "No operators match your search.",
      onClear: () => void 0,
      next: [{ kind: "docs", label: "How search works", href: "https://langwatch.ai/docs" }],
    },
  },
};
export const Failed: Story = {
  args: {
    state: "error",
    error: {
      title: "Operators could not load",
      description: "Try again in a moment.",
      onRetry: () => void 0,
      next: [{ kind: "docs", label: "Check the status page", href: "https://status.langwatch.ai" }],
    },
  },
};
/** A failed refetch with rows still on screen: an inline notice, never a blank page. */
export const FailedWithRows: Story = {
  args: {
    error: {
      title: "Showing the last results",
      description: "The refresh failed.",
      next: [{ kind: "docs", label: "Check the status page", href: "https://status.langwatch.ai" }],
    },
  },
};
export const AppendFeed: Story = {
  args: {
    pagination: undefined,
    loadMore: {
      hasMore: true,
      loading: false,
      onLoadMore: () => void 0,
      shown: 1,
      total: 40,
      unitLabel: "operators",
    },
  },
};
export const WithBack: Story = {
  args: {
    title: "Platform team",
    back: { label: "Teams", href: "/teams", onNavigate: () => void 0 },
  },
};
export const Selection: Story = {
  args: {
    selection: {
      label: "1 selected",
      onClear: () => void 0,
      children: <Button size="xs">Revoke</Button>,
    },
  },
};
/** The bar as the first band of the page, for a list that lives in a drawer or dialog. */
export const SelectionInline: Story = {
  args: {
    selection: {
      placement: "inline",
      label: "1 selected",
      onClear: () => void 0,
      children: <Button size="xs">Revoke</Button>,
    },
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
      <Box maxWidth="320px">
        <Story />
      </Box>
    ),
  ],
};
