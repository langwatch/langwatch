import { Box, IconButton } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { MoreHorizontal } from "lucide-react";
import { useState } from "react";

import { triState } from "../../workshop/list-table-rich-cells.tsx";
import { ListTable, type SortDirection } from "./list-table.tsx";

const AGENTS = [
  { id: "a1", name: "Weather agent", owner: "Platform", runs: 1204 },
  { id: "a2", name: "Support triage", owner: "Support", runs: 311 },
  { id: "a3", name: "Refund policy answer", owner: "Billing", runs: 87 },
];

const docs = [
  { kind: "docs", label: "Read about agents", href: "https://langwatch.ai/docs" },
] as const;

const meta = {
  title: "Data display/List table parts",
  component: ListTable,
  tags: ["autodocs"],
  parameters: {
    usage: {
      use: "The closed parts of ListTable: Header, Body, Row, Cell, ColumnHeader, ColumnGroup/Column, RowAction (the keyboard target of a clickable row), SelectHeader/SelectCell, ExpandCell, SortHeader (Shift for multi-sort), IdCell, ActionHeader/ActionCell, LoadingRows, EmptyRow (always with a next step), SpanRow and PaddingRow. Parts take meaning, never styling.",
      avoid:
        "Raw Table parts, cosmetic props on a part (none exist), a click handler on a row without a RowAction, or an empty row without a next step.",
    },
  },
} satisfies Meta<typeof ListTable>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The row opens by mouse anywhere; the name is the one tab stop, a real link or button. */
export const ClickableRowsWithRowAction: Story = {
  render: () => (
    <ListTable>
      <ListTable.Header>
        <ListTable.Row>
          <ListTable.ColumnHeader>Agent</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>Owner</ListTable.ColumnHeader>
          <ListTable.ColumnHeader align="end">Runs</ListTable.ColumnHeader>
          <ListTable.ActionHeader />
        </ListTable.Row>
      </ListTable.Header>
      <ListTable.Body>
        {AGENTS.map((agent, index) => (
          <ListTable.Row key={agent.id} onActivate={() => undefined} disabled={index === 2}>
            <ListTable.Cell>
              {index === 0 ? (
                <ListTable.RowAction href={`/agents/${agent.id}`} onNavigate={() => undefined}>
                  {agent.name}
                </ListTable.RowAction>
              ) : (
                <ListTable.RowAction onActivate={() => undefined}>{agent.name}</ListTable.RowAction>
              )}
            </ListTable.Cell>
            <ListTable.Cell tone="muted">{agent.owner}</ListTable.Cell>
            <ListTable.Cell numeric>{agent.runs}</ListTable.Cell>
            <ListTable.ActionCell>
              <IconButton size="xs" variant="ghost" aria-label={`Actions for ${agent.name}`}>
                <MoreHorizontal />
              </IconButton>
            </ListTable.ActionCell>
          </ListTable.Row>
        ))}
      </ListTable.Body>
    </ListTable>
  ),
};

function SelectableTable({ narrow = false }: { narrow?: boolean }) {
  const [selected, setSelected] = useState<string[]>(["a2"]);
  const table = (
    <ListTable
      {...(narrow ? { scroll: "x" as const, scrollLabel: "Agents", minWidth: "36rem" } : {})}
      id="agents"
    >
      <ListTable.Header>
        <ListTable.Row>
          <ListTable.SelectHeader
            checked={triState({ count: selected.length, total: AGENTS.length })}
            onCheckedChange={({ checked }) => setSelected(checked ? AGENTS.map((a) => a.id) : [])}
            label={`Select all ${AGENTS.length} rows`}
          />
          <ListTable.ColumnHeader>Agent</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>Owner</ListTable.ColumnHeader>
          <ListTable.ActionHeader />
        </ListTable.Row>
      </ListTable.Header>
      <ListTable.Body>
        {AGENTS.map((agent) => (
          <ListTable.Row key={agent.id} selected={selected.includes(agent.id)}>
            <ListTable.SelectCell
              checked={selected.includes(agent.id)}
              onCheckedChange={({ checked }) =>
                setSelected((now) =>
                  checked ? [...now, agent.id] : now.filter((id) => id !== agent.id),
                )
              }
              label={`Select ${agent.name}`}
            />
            <ListTable.Cell>{agent.name}</ListTable.Cell>
            <ListTable.Cell>{agent.owner}</ListTable.Cell>
            <ListTable.ActionCell>
              <IconButton size="xs" variant="ghost" aria-label={`Actions for ${agent.name}`}>
                <MoreHorizontal />
              </IconButton>
            </ListTable.ActionCell>
          </ListTable.Row>
        ))}
      </ListTable.Body>
    </ListTable>
  );
  return narrow ? <Box maxWidth="320px">{table}</Box> : table;
}

/** A leading checkbox column pinned left, a tri-state select-all and a selected tint. */
export const Selection: Story = { render: () => <SelectableTable /> };
/** At 320px the leading checkboxes and trailing actions stay pinned; the middle scrolls. */
export const SelectionNarrow: Story = { render: () => <SelectableTable narrow /> };

function ExpandingTable() {
  const [open, setOpen] = useState<string[]>(["a1"]);
  return (
    <ListTable>
      <ListTable.Header>
        <ListTable.Row>
          <ListTable.ColumnHeader label="Details" width="fit" />
          <ListTable.ColumnHeader>Agent</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>Owner</ListTable.ColumnHeader>
        </ListTable.Row>
      </ListTable.Header>
      <ListTable.Body>
        {AGENTS.map((agent) => {
          const isOpen = open.includes(agent.id);
          return (
            <ListTable.Row key={agent.id} expanded={isOpen}>
              <ListTable.ExpandCell
                expanded={isOpen}
                onToggle={() =>
                  setOpen((now) =>
                    isOpen ? now.filter((id) => id !== agent.id) : [...now, agent.id],
                  )
                }
                label={`Show details for ${agent.name}`}
                panelId={`detail-${agent.id}`}
              />
              <ListTable.Cell>{agent.name}</ListTable.Cell>
              <ListTable.Cell>{agent.owner}</ListTable.Cell>
            </ListTable.Row>
          );
        })}
        {AGENTS.filter((agent) => open.includes(agent.id)).map((agent) => (
          <ListTable.SpanRow key={agent.id} id={`detail-${agent.id}`} columns={3}>
            <Box padding={4} textStyle="sm" color="fg.muted">
              {agent.runs} runs this month.
            </Box>
          </ListTable.SpanRow>
        ))}
      </ListTable.Body>
    </ListTable>
  );
}

/** A chevron button controls the detail rows below; aria-expanded lives on the button. */
export const Expansion: Story = { render: () => <ExpandingTable /> };

function SortingTable() {
  const [sorts, setSorts] = useState<{ column: "name" | "runs"; direction: SortDirection }[]>([
    { column: "name", direction: "asc" },
  ]);
  const toggle = ({ column, multi }: { column: "name" | "runs"; multi: boolean }) =>
    setSorts((now) => {
      const current = now.find((sort) => sort.column === column);
      const flipped = {
        column,
        direction: current?.direction === "asc" ? ("desc" as const) : ("asc" as const),
      };
      if (!multi) return [flipped];
      return current
        ? now.map((sort) => (sort.column === column ? flipped : sort))
        : [...now, flipped];
    });
  const head = (column: "name" | "runs") => {
    const at = sorts.findIndex((sort) => sort.column === column);
    return {
      sorted: sorts[at]?.direction ?? (false as const),
      sortRank: sorts.length > 1 && at >= 0 ? at + 1 : undefined,
      onSort: ({ multi }: { multi: boolean }) => toggle({ column, multi }),
    };
  };
  return (
    <ListTable>
      <ListTable.Header>
        <ListTable.Row>
          <ListTable.SortHeader {...head("name")}>Agent</ListTable.SortHeader>
          <ListTable.SortHeader {...head("runs")} align="end">
            Runs
          </ListTable.SortHeader>
        </ListTable.Row>
      </ListTable.Header>
      <ListTable.Body>
        {AGENTS.map((agent) => (
          <ListTable.Row key={agent.id}>
            <ListTable.Cell>{agent.name}</ListTable.Cell>
            <ListTable.Cell numeric>{agent.runs}</ListTable.Cell>
          </ListTable.Row>
        ))}
      </ListTable.Body>
    </ListTable>
  );
}

/** Click sorts by one column; Shift-click adds a column, and the order number shows from two. */
export const MultiSort: Story = { render: () => <SortingTable /> };

export const Busy: Story = {
  render: () => (
    <ListTable loading loadingLabel="Loading agents">
      <ListTable.Header>
        <ListTable.Row>
          <ListTable.ColumnHeader>Agent</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>Owner</ListTable.ColumnHeader>
        </ListTable.Row>
      </ListTable.Header>
      <ListTable.Body>
        <ListTable.LoadingRows rows={3} columns={2} />
      </ListTable.Body>
    </ListTable>
  ),
};

function emptyRows(columns: number) {
  return (
    <>
      <ListTable.Header>
        <ListTable.Row>
          <ListTable.ColumnHeader>Agent</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>Owner</ListTable.ColumnHeader>
        </ListTable.Row>
      </ListTable.Header>
      <ListTable.Body>
        <ListTable.EmptyRow
          columns={columns}
          state="empty"
          title="No agents yet"
          description="Agents appear here once they send a trace."
          next={docs}
        />
        <ListTable.EmptyRow
          columns={columns}
          state="no-results"
          title="No agents match this owner"
          next={docs}
          onClearFilters={() => undefined}
        />
        <ListTable.EmptyRow
          columns={columns}
          state="error"
          title="Agents could not be loaded"
          description="Try again in a moment."
          next={docs}
          onRetry={() => undefined}
        />
        <ListTable.EmptyRow
          columns={columns}
          state="empty"
          size="block"
          title="No agents yet"
          description="Agents appear here once they send a trace."
          next={docs}
        />
      </ListTable.Body>
    </>
  );
}

/** Empty, no results, failure (a Banner) and the block size; each with its next step. */
export const EmptyRows: Story = { render: () => <ListTable>{emptyRows(2)}</ListTable> };
export const EmptyRowsNarrow: Story = {
  render: () => (
    <Box maxWidth="320px">
      <ListTable>{emptyRows(2)}</ListTable>
    </Box>
  ),
};

/** `rowHeight` makes every body row exactly that tall, on one line, for a virtualiser. */
export const FixedRowHeight: Story = {
  render: () => (
    <ListTable scroll="external" rowHeight={49} tableLayout="fixed">
      <ListTable.ColumnGroup>
        <ListTable.Column width="14rem" />
        <ListTable.Column width="8rem" />
      </ListTable.ColumnGroup>
      <ListTable.Header>
        <ListTable.Row aria-rowindex={1}>
          <ListTable.ColumnHeader>Agent</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>Owner</ListTable.ColumnHeader>
        </ListTable.Row>
      </ListTable.Header>
      <ListTable.Body>
        <ListTable.PaddingRow columns={2} height={98} />
        {AGENTS.map((agent, index) => (
          <ListTable.Row key={agent.id} aria-rowindex={index + 4}>
            <ListTable.Cell truncate>{agent.name}</ListTable.Cell>
            <ListTable.Cell>{agent.owner}</ListTable.Cell>
          </ListTable.Row>
        ))}
      </ListTable.Body>
    </ListTable>
  ),
};

export const RowTones: Story = {
  render: () => (
    <ListTable>
      <ListTable.Body>
        <ListTable.Row tone="warning">
          <ListTable.Cell>Queue is backing up</ListTable.Cell>
        </ListTable.Row>
        <ListTable.Row tone="danger">
          <ListTable.Cell>Projection failed</ListTable.Cell>
        </ListTable.Row>
        <ListTable.Row selected>
          <ListTable.Cell>Selected</ListTable.Cell>
        </ListTable.Row>
        <ListTable.Row disabled>
          <ListTable.Cell>Unavailable</ListTable.Cell>
        </ListTable.Row>
      </ListTable.Body>
    </ListTable>
  ),
};
