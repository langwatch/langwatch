import {
  Alert,
  Badge,
  Box,
  Button,
  HStack,
  Skeleton,
  Spacer,
  Stack,
  Table,
} from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { FileText } from "lucide-react";
import type { ReactNode } from "react";

import { SearchInput } from "../components/forms/search-input.tsx";
import { FilterChips } from "../components/layout/filter-chips.tsx";
import { ListTable } from "../components/layout/list-table.tsx";
import { PageLayout } from "../components/layout/page-layout.tsx";
import { Pagination } from "../components/layout/pagination.tsx";
import { Menu } from "../components/overlays/menu.tsx";
import { NoDataInfoBlock } from "../components/states/no-data-info-block.tsx";

const PROMPTS = [
  { name: "Support triage", model: "gpt-5-mini", version: 14, status: "Published" },
  { name: "Refund policy answerer", model: "claude-sonnet-4-5", version: 3, status: "Draft" },
  {
    name: "Summarise a conversation for the handover note",
    model: "gemini-2.5-flash",
    version: 27,
    status: "Published",
  },
];

function Frame({ children }: { children: ReactNode }) {
  return (
    <Box
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="md"
      overflow="hidden"
      bg="bg.page"
    >
      <PageLayout.Header>
        <PageLayout.Heading>Prompts</PageLayout.Heading>
        <Spacer />
        <PageLayout.HeaderButton primary>New prompt</PageLayout.HeaderButton>
      </PageLayout.Header>
      <PageLayout.Container sidebarWidth={0}>
        <PageLayout.Content>
          <Stack gap={4}>
            <HStack gap={3}>
              <FilterChips
                value="all"
                onChange={() => undefined}
                groupLabel="Filter prompts"
                items={[
                  { value: "all", label: "All", count: 3 },
                  { value: "draft", label: "Drafts", count: 1 },
                ]}
              />
              <Spacer />
              <Box width="16rem">
                <SearchInput placeholder="Search prompts" size="sm" />
              </Box>
            </HStack>
            {children}
          </Stack>
        </PageLayout.Content>
      </PageLayout.Container>
    </Box>
  );
}

function Rows({ loading = false }: { loading?: boolean }) {
  return (
    <ListTable>
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeader>Prompt</Table.ColumnHeader>
          <Table.ColumnHeader>Model</Table.ColumnHeader>
          <Table.ColumnHeader>Version</Table.ColumnHeader>
          <Table.ColumnHeader>Status</Table.ColumnHeader>
          <Table.ColumnHeader width={12} />
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {PROMPTS.map((prompt) => (
          <Table.Row key={prompt.name}>
            {loading ? (
              <Table.Cell colSpan={5}>
                <Skeleton height={4} />
              </Table.Cell>
            ) : (
              <>
                <Table.Cell>{prompt.name}</Table.Cell>
                <Table.Cell>{prompt.model}</Table.Cell>
                <Table.Cell>v{prompt.version}</Table.Cell>
                <Table.Cell>
                  <Badge colorPalette={prompt.status === "Draft" ? "gray" : "green"}>
                    {prompt.status}
                  </Badge>
                </Table.Cell>
                <Table.Cell>
                  <Menu.Root>
                    <Menu.Trigger asChild>
                      <Button size="xs" variant="ghost" aria-label={`Actions for ${prompt.name}`}>
                        ⋯
                      </Button>
                    </Menu.Trigger>
                    <Menu.Content>
                      <Menu.Item value="duplicate">Duplicate</Menu.Item>
                      <Menu.Item value="delete" color="fg.error">
                        Delete
                      </Menu.Item>
                    </Menu.Content>
                  </Menu.Root>
                </Table.Cell>
              </>
            )}
          </Table.Row>
        ))}
      </Table.Body>
    </ListTable>
  );
}

const meta = {
  title: "Patterns/List page",
  parameters: {
    layout: "fullscreen",
    usage: {
      use: "Any page that lists one kind of thing: Page layout header with the primary action, filter chips and search above, a List table with an overflow menu per row, Pagination below. Empty, loading and error take the table's place.",
      avoid:
        "A page heading drawn by hand, a bare Table.Root, or row actions as a row of buttons (row-actions-overflow-menu.md).",
    },
  },
  tags: ["autodocs"],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Frame>
      <Rows />
      <Box borderWidth="1px" borderColor="border.muted" borderRadius="md">
        <Pagination
          page={1}
          pageSize={25}
          totalCount={3}
          unitLabel="prompts"
          onPageChange={() => undefined}
          onPageSizeChange={() => undefined}
        />
      </Box>
    </Frame>
  ),
};

export const Loading: Story = {
  render: () => (
    <Frame>
      <Rows loading />
    </Frame>
  ),
};

export const Empty: Story = {
  render: () => (
    <Frame>
      <NoDataInfoBlock
        title="No prompts yet"
        description="Prompts hold the instructions your agents send, with every version kept."
        icon={<FileText />}
      >
        <Button size="sm">New prompt</Button>
      </NoDataInfoBlock>
    </Frame>
  ),
};

export const Failed: Story = {
  render: () => (
    <Frame>
      <Alert.Root status="error">
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Title>Could not load the prompts</Alert.Title>
          <Alert.Description>We have been notified. Try again in a moment.</Alert.Description>
        </Alert.Content>
      </Alert.Root>
    </Frame>
  ),
};
