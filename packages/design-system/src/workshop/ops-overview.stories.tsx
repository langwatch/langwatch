import { Badge, Box, Button, Card, HStack, Stack, Table, Text } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Layers } from "lucide-react";
import { useState } from "react";

import { CodePreview } from "../components/display/code-preview.tsx";
import { SummaryList, SummaryListItem } from "../components/display/summary-list.tsx";
import { SearchInput } from "../components/forms/search-input.tsx";
import { FilterChips } from "../components/layout/filter-chips.tsx";
import { ListPage, ListPageError } from "../components/layout/list-page.tsx";
import { ListTable } from "../components/layout/list-table.tsx";
import { DetailDrawerHeader } from "../components/overlays/detail-drawer-header.tsx";
import { Drawer } from "../components/overlays/drawer.tsx";
import { NoDataInfoBlock } from "../components/states/no-data-info-block.tsx";
import { StatTile, StatTileFigure, StatTileGrid } from "../components/values/stat-tile.tsx";

const PROCESSES = [
  { name: "Webhook delivery", instances: 184, pending: 12, dead: 2 },
  { name: "Evaluation execution", instances: 72, pending: 0, dead: 0 },
  { name: "Daily usage aggregation", instances: 28, pending: 3, dead: 0 },
];

function OpsOverviewExample({
  loading = false,
  failed = false,
  empty = false,
  details = false,
  longText = false,
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState<(typeof PROCESSES)[number] | null>(
    details ? PROCESSES[0]! : null,
  );
  const processes = empty ? [] : PROCESSES;
  const rows = processes.filter(
    (row) =>
      row.name.toLowerCase().includes(search.toLowerCase()) && (filter === "all" || row.dead > 0),
  );
  return (
    <Box bg="bg.page" minHeight="480px">
      <ListPage
        title="Processes"
        subtitle="Follow pending work and investigate delivery failures."
        loading={loading}
        error={
          failed ? (
            <ListPageError title="Processes could not load">Try again in a moment.</ListPageError>
          ) : (
            void 0
          )
        }
        toolbar={
          <HStack wrap="wrap" gap={3}>
            <FilterChips
              groupLabel="Filter processes"
              value={filter}
              onChange={setFilter}
              items={[
                { value: "all", label: "All", count: processes.length },
                {
                  value: "attention",
                  label: "Needs attention",
                  count: processes.filter((row) => row.dead > 0).length,
                },
              ]}
            />
            <Box flex="1" minWidth="48">
              <SearchInput
                containerProps={{ width: "full", minWidth: 0 }}
                aria-label="Search processes"
                placeholder="Search processes"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </Box>
          </HStack>
        }
        empty={
          rows.length === 0 ? (
            <NoDataInfoBlock
              icon={<Layers />}
              title="No matching processes"
              description="Try a different search or filter."
            />
          ) : (
            void 0
          )
        }
      >
        <Stack gap={4}>
          <StatTileGrid columns={3}>
            <StatTile variant="elevated" label="Instances">
              <StatTileFigure>284</StatTileFigure>
            </StatTile>
            <StatTile variant="elevated" label="Pending messages">
              <StatTileFigure>15</StatTileFigure>
            </StatTile>
            <StatTile variant="elevated" label="Dead messages" hint="Waiting for an operator">
              <StatTileFigure>2</StatTileFigure>
            </StatTile>
          </StatTileGrid>
          <ListTable density="compact" columnRules={false} containerProps={{ overflowX: "auto" }}>
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeader>Process</Table.ColumnHeader>
                <Table.ColumnHeader textAlign="end">Instances</Table.ColumnHeader>
                <Table.ColumnHeader textAlign="end">Pending</Table.ColumnHeader>
                <Table.ColumnHeader>Status</Table.ColumnHeader>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {rows.map((row) => (
                <Table.Row key={row.name}>
                  <Table.Cell>
                    <Button
                      variant="plain"
                      size="sm"
                      onClick={() => setSelected(row)}
                      whiteSpace="normal"
                      textAlign="start"
                    >
                      {longText
                        ? `${row.name} for the Europe production environment and its connected projects`
                        : row.name}
                    </Button>
                  </Table.Cell>
                  <Table.Cell textAlign="end">{row.instances}</Table.Cell>
                  <Table.Cell textAlign="end">{row.pending}</Table.Cell>
                  <Table.Cell>
                    <Badge colorPalette={row.dead ? "red" : "green"}>
                      {row.dead ? "Needs attention" : "Healthy"}
                    </Badge>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </ListTable>
        </Stack>
      </ListPage>
      <Drawer.Root
        open={selected !== null}
        size="lg"
        onOpenChange={({ open }) => {
          if (!open) setSelected(null);
        }}
      >
        <Drawer.Content>
          <Drawer.CloseTrigger />
          <Drawer.Header>
            <DetailDrawerHeader
              icon={<Layers size={14} />}
              kind="Process"
              title={selected?.name ?? "Process"}
            />
          </Drawer.Header>
          <Drawer.Body>
            {selected && (
              <Stack gap={5}>
                <Card.Root variant="subtle">
                  <Card.Body>
                    <SummaryList>
                      <SummaryListItem label="Instances">{selected.instances}</SummaryListItem>
                      <SummaryListItem label="Pending">{selected.pending}</SummaryListItem>
                      <SummaryListItem label="Dead messages">{selected.dead}</SummaryListItem>
                    </SummaryList>
                  </Card.Body>
                </Card.Root>
                <Text textStyle="sm" color="fg.muted">
                  Inspect the checkpoint before choosing a recovery action.
                </Text>
                <CodePreview
                  filename="Checkpoint"
                  language="json"
                  compact
                  lineNumbers
                  code={JSON.stringify(
                    { process: selected.name, pendingMessages: selected.pending },
                    null,
                    2,
                  )}
                />
              </Stack>
            )}
          </Drawer.Body>
          <Drawer.Footer>
            <Button variant="outline" onClick={() => setSelected(null)}>
              Close
            </Button>
          </Drawer.Footer>
        </Drawer.Content>
      </Drawer.Root>
    </Box>
  );
}

const meta = {
  title: "Patterns/Ops overview",
  component: OpsOverviewExample,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    usage: {
      use: "An operational list composed from ListPage, FilterChips, SearchInput, elevated StatTile figures, compact ListTable, and the shared entity Drawer. Filtering and detail opening work with sample data.",
      avoid:
        "Copying transport or permission logic into the design system. Ops owns those behaviours; these pieces only present controlled data.",
    },
  },
} satisfies Meta<typeof OpsOverviewExample>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const Loading: Story = { args: { loading: true } };
export const Empty: Story = { args: { empty: true } };
export const Failed: Story = { args: { failed: true } };
export const Detail: Story = { args: { details: true } };
export const LongText: Story = { args: { longText: true } };
export const Narrow: Story = {
  decorators: [
    (Story) => (
      <Box maxWidth="360px">
        <Story />
      </Box>
    ),
  ],
};
