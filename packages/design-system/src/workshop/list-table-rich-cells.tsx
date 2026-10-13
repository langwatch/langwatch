/**
 * Cells that hold really rich content, hosted by a measured virtual ListTable. The renderers
 * are plain React the shell never touches: this is the proof that migrating a table swaps
 * only the shell (root, rows, header, geometry, selection, actions) around them.
 */
import { Box, HStack, Stack, Text } from "@chakra-ui/react";
import { ChevronRight } from "lucide-react";
import { useRef, useState } from "react";

import { ListTable } from "../components/layout/list-table.tsx";
import { MessageRoleLabel, type MessageRole } from "../components/messages/message-role-label.tsx";
import { parseUnifiedDiff } from "../unified-diff.ts";

export interface ToolCall {
  name: string;
  detail: string;
  children: ToolCall[];
}

export interface RichRow {
  id: string;
  name: string;
  prompt: { heading: string; items: string[]; code: string };
  tools: ToolCall[];
  output: unknown;
  chat: { role: MessageRole; text: string }[];
  image: string;
  diff: string;
}

const PICTURE =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90"><rect width="160" height="90" fill="#cbd5e1"/><circle cx="48" cy="40" r="18" fill="#94a3b8"/><path d="M0 90 L60 50 L100 70 L160 30 V90Z" fill="#64748b"/></svg>',
  );

const DIFF = [
  "@@ -1,5 +1,6 @@",
  " export function total(items) {",
  "-  return items.reduce((a, b) => a + b.price, 0);",
  "+  const sum = items.reduce((a, b) => a + b.price * b.quantity, 0);",
  "+  return Math.round(sum * 100) / 100;",
  " }",
].join("\n");

export function makeRichRows(count: number): RichRow[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `row-${index}`,
    name: `Run ${index + 1}`,
    prompt: {
      heading: `Summarise ticket ${index + 1}`,
      items: ["Keep it under 80 words", "Quote the customer's own phrase", "Name the next step"],
      code: `summarise({ ticket: ${index + 1}, tone: "plain" })`,
    },
    tools: [
      {
        name: "search_orders",
        detail: `{ "customer": ${index + 1} }`,
        children: [
          { name: "load_customer", detail: "profile, plan, region", children: [] },
          {
            name: "list_invoices",
            detail: "last 12 months",
            children: [{ name: "format_currency", detail: "GBP", children: [] }],
          },
        ],
      },
    ],
    output: {
      ticket: index + 1,
      summary: "The customer was double charged and wants a refund by Friday.",
      entries: Array.from({ length: 90 }, (_, entry) => ({
        id: `entry-${entry}`,
        score: (entry * 37) % 100,
        tags: ["billing", "refund", "urgent"],
      })),
    },
    chat: [
      { role: "system", text: "You triage support tickets." },
      { role: "user", text: `Ticket ${index + 1}: I was charged twice for my plan.` },
      { role: "assistant", text: "I have found both charges and started a refund." },
    ],
    image: PICTURE,
    diff: DIFF,
  }));
}

/** Nested markdown, as rendered: a heading, a list and a fenced code block. */
export function MarkdownCell({ row }: { row: RichRow }) {
  return (
    <Stack gap={1} textStyle="sm">
      <Text as="h4" fontWeight="semibold">
        {row.prompt.heading}
      </Text>
      <Box as="ul" paddingStart={4}>
        {row.prompt.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </Box>
      <Box as="pre" fontFamily="mono" textStyle="xs" whiteSpace="pre-wrap">
        {row.prompt.code}
      </Box>
    </Stack>
  );
}

function ToolNode({ call }: { call: ToolCall }) {
  const [open, setOpen] = useState(false);
  return (
    <Box as="li" listStyleType="none">
      <HStack gap={1}>
        {call.children.length > 0 ? (
          <button
            type="button"
            aria-expanded={open}
            aria-label={`${open ? "Collapse" : "Expand"} ${call.name}`}
            onClick={() => setOpen(!open)}
          >
            <ChevronRight size={12} style={{ transform: open ? "rotate(90deg)" : undefined }} />
          </button>
        ) : null}
        <Text textStyle="xs" fontFamily="mono">
          {call.name} {call.detail}
        </Text>
      </HStack>
      {open && (
        <Box as="ul" paddingStart={4}>
          {call.children.map((child) => (
            <ToolNode key={child.name} call={child} />
          ))}
        </Box>
      )}
    </Box>
  );
}

/** A tool-call tree: nested, each node expandable. */
export function ToolTreeCell({ row }: { row: RichRow }) {
  return (
    <Box as="ul">
      {row.tools.map((call) => (
        <ToolNode key={call.name} call={call} />
      ))}
    </Box>
  );
}

/** A long JSON value, about five thousand characters. */
export function JsonCell({ row }: { row: RichRow }) {
  return (
    <Box as="pre" fontFamily="mono" textStyle="2xs" whiteSpace="pre-wrap" wordBreak="break-all">
      {JSON.stringify(row.output)}
    </Box>
  );
}

export function ChatCell({ row }: { row: RichRow }) {
  return (
    <Stack gap={1}>
      {row.chat.map((message) => (
        <Stack key={message.text} gap={0.5}>
          <MessageRoleLabel messageRole={message.role} />
          <Text textStyle="xs">{message.text}</Text>
        </Stack>
      ))}
    </Stack>
  );
}

export function ImageCell({ row }: { row: RichRow }) {
  return <img src={row.image} alt={`Screenshot of ${row.name}`} width={160} height={90} />;
}

const DIFF_MARK = { add: "+", remove: "-", context: " ", hunk: " ", meta: " " } as const;
const DIFF_GROUND = {
  add: "green.subtle",
  remove: "red.subtle",
  context: undefined,
  hunk: undefined,
  meta: undefined,
} as const;

export function DiffCell({ row }: { row: RichRow }) {
  return (
    <Box as="pre" fontFamily="mono" textStyle="2xs">
      {parseUnifiedDiff(row.diff).map((line, index) => (
        <Box key={index} as="span" display="block" bg={DIFF_GROUND[line.kind]}>
          {DIFF_MARK[line.kind]} {line.text}
        </Box>
      ))}
    </Box>
  );
}

/** The select-all state a caller derives from its own selection. */
export function triState({ count, total }: { count: number; total: number }) {
  if (count === 0) return false;
  return count === total ? true : ("indeterminate" as const);
}

export const RICH_COLUMNS = 10;
const ESTIMATE = 220;

/**
 * A measured virtual table: the caller owns the scroller and the window; rows are measured
 * from their `tbody` group after commit by a ResizeObserver and never given a fixed height.
 */
export function MeasuredRichTable({
  rows,
  viewport = 480,
}: {
  rows: readonly RichRow[];
  viewport?: number;
}) {
  const [heights, setHeights] = useState<Record<number, number>>({});
  const [scrollTop, setScrollTop] = useState(0);
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [open, setOpen] = useState<readonly string[]>([]);
  const observers = useRef(new Map<number, ResizeObserver>());

  const heightOf = (index: number) => heights[index] ?? ESTIMATE;
  const offsets = rows.reduce<number[]>(
    (all, _row, index) => [...all, (all[index] ?? 0) + heightOf(index)],
    [0],
  );
  const total = offsets[rows.length] ?? 0;
  const first = Math.max(0, offsets.findLastIndex((offset) => offset <= scrollTop) - 1);
  const end = offsets.findIndex((offset) => offset >= scrollTop + viewport);
  const last = end === -1 ? rows.length - 1 : Math.min(rows.length - 1, Math.max(first, end) + 1);
  const visible = rows.slice(first, last + 1);
  const before = offsets[first] ?? 0;
  const after = total - (offsets[last + 1] ?? total);

  const measure = (index: number, node: HTMLElement | null) => {
    observers.current.get(index)?.disconnect();
    if (!node) return;
    const read = () => {
      const height = Math.round(node.getBoundingClientRect().height);
      setHeights((now) => (now[index] === height ? now : { ...now, [index]: height }));
    };
    read();
    const observer = new ResizeObserver(read);
    observer.observe(node);
    observers.current.set(index, observer);
  };

  return (
    <Box
      as="section"
      aria-label="Runs"
      tabIndex={0}
      height={`${viewport}px`}
      overflow="auto"
      minWidth={0}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      data-testid="scroller"
    >
      <ListTable
        scroll="external"
        stickyHeader
        aria-rowcount={rows.length + 1}
        aria-colcount={RICH_COLUMNS}
      >
        <ListTable.Header>
          <ListTable.Row aria-rowindex={1}>
            <ListTable.SelectHeader
              checked={triState({ count: selected.length, total: rows.length })}
              onCheckedChange={({ checked }) =>
                setSelected(checked ? rows.map((row) => row.id) : [])
              }
              label={`Select all ${rows.length} rows`}
            />
            <ListTable.ColumnHeader label="Details" width="fit" />
            <ListTable.ColumnHeader>Name</ListTable.ColumnHeader>
            <ListTable.ColumnHeader>Prompt</ListTable.ColumnHeader>
            <ListTable.ColumnHeader>Tool calls</ListTable.ColumnHeader>
            <ListTable.ColumnHeader>Output</ListTable.ColumnHeader>
            <ListTable.ColumnHeader>Conversation</ListTable.ColumnHeader>
            <ListTable.ColumnHeader>Screenshot</ListTable.ColumnHeader>
            <ListTable.ColumnHeader>Change</ListTable.ColumnHeader>
            <ListTable.ActionHeader />
          </ListTable.Row>
        </ListTable.Header>
        <ListTable.Body>
          <ListTable.PaddingRow columns={RICH_COLUMNS} height={before} />
        </ListTable.Body>
        {visible.map((row, offset) => {
          const index = first + offset;
          const isOpen = open.includes(row.id);
          return (
            <ListTable.Body
              key={row.id}
              ref={(node) => measure(index, node)}
              data-index={index}
              data-measured={heights[index]}
            >
              <ListTable.Row
                aria-rowindex={index + 2}
                selected={selected.includes(row.id)}
                expanded={isOpen}
              >
                <ListTable.SelectCell
                  checked={selected.includes(row.id)}
                  onCheckedChange={({ checked }) =>
                    setSelected((now) =>
                      checked ? [...now, row.id] : now.filter((id) => id !== row.id),
                    )
                  }
                  label={`Select ${row.name}`}
                />
                <ListTable.ExpandCell
                  expanded={isOpen}
                  onToggle={() =>
                    setOpen((now) =>
                      isOpen ? now.filter((id) => id !== row.id) : [...now, row.id],
                    )
                  }
                  label={`Show details for ${row.name}`}
                  panelId={`detail-${row.id}`}
                />
                <ListTable.Cell valign="top">
                  <ListTable.RowAction onActivate={() => undefined}>{row.name}</ListTable.RowAction>
                </ListTable.Cell>
                <ListTable.Cell valign="top">
                  <MarkdownCell row={row} />
                </ListTable.Cell>
                <ListTable.Cell valign="top">
                  <ToolTreeCell row={row} />
                </ListTable.Cell>
                <ListTable.Cell valign="top" maxWidth="22rem">
                  <JsonCell row={row} />
                </ListTable.Cell>
                <ListTable.Cell valign="top">
                  <ChatCell row={row} />
                </ListTable.Cell>
                <ListTable.Cell valign="top">
                  <ImageCell row={row} />
                </ListTable.Cell>
                <ListTable.Cell valign="top">
                  <DiffCell row={row} />
                </ListTable.Cell>
                <ListTable.ActionCell>
                  <button type="button" aria-label={`Actions for ${row.name}`}>
                    …
                  </button>
                </ListTable.ActionCell>
              </ListTable.Row>
              {isOpen && (
                <ListTable.SpanRow
                  id={`detail-${row.id}`}
                  columns={RICH_COLUMNS}
                  aria-rowindex={index + 3}
                >
                  <Box padding={4} textStyle="sm">
                    Full trace for {row.name}
                  </Box>
                </ListTable.SpanRow>
              )}
            </ListTable.Body>
          );
        })}
        <ListTable.Body>
          <ListTable.PaddingRow columns={RICH_COLUMNS} height={after} />
        </ListTable.Body>
      </ListTable>
    </Box>
  );
}
