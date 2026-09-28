/**
 * The tile and table block views of the Flight Deck: Status, Cost efficiency,
 * Failure intelligence, Scenario results, Gateway routing, Your coding agents
 * and Most impactful traces. Each reads the rows of its own statements only.
 */

import { Badge, Box, HStack, SimpleGrid, Table, Text, VStack } from "@chakra-ui/react";
import { ArrowDownRight, ArrowRight, ArrowUpRight, ThumbsDown, ThumbsUp } from "lucide-react";
import type { ReactNode } from "react";

import { periodDelta } from "../model/block-definition.ts";
import {
  type BlockRow,
  type BlockRows,
  formatBucket,
  formatCount,
  formatDelta,
  formatMs,
  formatRatio,
  formatUsd,
  rowNumber,
  rowText,
} from "../model/block-format.ts";
import { CHART_COLORS, RankingList, Sparkline } from "./block-charts.tsx";

export interface TableViewProps {
  readonly rows: BlockRows;
  readonly granularitySeconds: number;
}

/** Whether a rise is good news, bad news or neither. */
type Polarity = "upGood" | "upBad" | "neutral";

/** The delta line's colour: neutral grey, otherwise green for good news, red for bad. */
function colorFor({ neutral, good }: { neutral: boolean; good: boolean }): string {
  if (neutral) return "fg.muted";
  return good ? "green.fg" : "red.fg";
}

/** The delta line's arrow: up, down, or flat when neither. */
function deltaIcon({ up, down }: { up: boolean; down: boolean }) {
  if (up) return ArrowUpRight;
  if (down) return ArrowDownRight;
  return ArrowRight;
}

function DeltaLine({ delta, polarity }: { delta: number; polarity: Polarity }) {
  const up = delta > 0.0005;
  const down = delta < -0.0005;
  const good = polarity === "upGood" ? up : down;
  const color = colorFor({ neutral: polarity === "neutral" || (!up && !down), good });
  const Icon = deltaIcon({ up, down });
  return (
    <HStack gap={0.5} fontSize="11px" color={color}>
      <Icon size={12} />
      {formatDelta(delta)}
      <Text as="span" color="fg.muted">
        vs prev
      </Text>
    </HStack>
  );
}

function Tile({
  label,
  value,
  delta,
  polarity,
}: {
  label: string;
  value: string;
  delta: number;
  polarity: Polarity;
}) {
  return (
    <Box borderWidth="1px" borderRadius="lg" paddingX={3} paddingY={2.5} data-testid="status-tile">
      <Text fontSize="12px" color="fg.muted">
        {label}
      </Text>
      <Text fontSize="22px" fontWeight="semibold" lineHeight="short">
        {value}
      </Text>
      <DeltaLine delta={delta} polarity={polarity} />
    </Box>
  );
}

/**
 * Request volume, success rate, p95 latency and total cost, each against
 * the previous period (AC5).
 */
export function StatusView({ rows }: TableViewProps) {
  const row = rows.main?.[0];
  const requests = rowNumber(row, "requests");
  const requestsPrev = rowNumber(row, "requests_prev");
  const success = requests > 0 ? 1 - rowNumber(row, "errors") / requests : 0;
  const successPrev = requestsPrev > 0 ? 1 - rowNumber(row, "errors_prev") / requestsPrev : 0;
  const delta = (key: string) =>
    periodDelta({ current: rowNumber(row, key), previous: rowNumber(row, `${key}_prev`) });
  return (
    <SimpleGrid columns={{ base: 2, lg: 4 }} gap={3}>
      <Tile
        label="Request volume"
        value={formatCount(requests)}
        delta={delta("requests")}
        polarity="neutral"
      />
      <Tile
        label="Success rate"
        value={formatRatio(success)}
        delta={periodDelta({ current: success, previous: successPrev })}
        polarity="upGood"
      />
      <Tile
        label="p95 latency"
        value={formatMs(rowNumber(row, "p95_ms"))}
        delta={delta("p95_ms")}
        polarity="upBad"
      />
      <Tile
        label="Total cost"
        value={formatUsd(rowNumber(row, "cost"))}
        delta={delta("cost")}
        polarity="upBad"
      />
    </SimpleGrid>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <Box borderRadius="md" background="bg.muted" paddingX={2} paddingY={1.5}>
      <Text fontSize="11px" color="fg.muted">
        {label}
      </Text>
      <Text fontSize="15px" fontWeight="semibold">
        {value}
      </Text>
    </Box>
  );
}

export function CostEfficiencyView({ rows }: TableViewProps) {
  const summary = rows.summary?.[0];
  const successes = rowNumber(summary, "successes");
  const cost = rowNumber(summary, "cost");
  return (
    <VStack align="stretch" gap={3}>
      <SimpleGrid columns={3} gap={2}>
        <MiniStat label="Cost / success" value={formatUsd(successes > 0 ? cost / successes : 0)} />
        <MiniStat label="Tokens in" value={formatCount(rowNumber(summary, "tokens_in"))} />
        <MiniStat label="Tokens out" value={formatCount(rowNumber(summary, "tokens_out"))} />
      </SimpleGrid>
      <Text fontSize="12px" fontWeight="medium" color="fg.muted">
        Highest-cost models
      </Text>
      <RankingList rows={rows.models ?? []} unit="usd" color={CHART_COLORS.series[3]} />
    </VStack>
  );
}

interface Column {
  readonly header: string;
  readonly numeric?: boolean;
  readonly cell: (row: BlockRow) => ReactNode;
}

function RowsTable({
  rows,
  columns,
  rowKey,
}: {
  rows: readonly BlockRow[];
  columns: readonly Column[];
  rowKey: (row: BlockRow) => string;
}) {
  return (
    <Table.Root size="sm" variant="line">
      <Table.Header>
        <Table.Row>
          {columns.map((column) => (
            <Table.ColumnHeader
              key={column.header}
              textAlign={column.numeric ? "end" : "start"}
              color="fg.muted"
            >
              {column.header}
            </Table.ColumnHeader>
          ))}
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {rows.map((row) => (
          <Table.Row key={rowKey(row)}>
            {columns.map((column) => (
              <Table.Cell
                key={column.header}
                textAlign={column.numeric ? "end" : "start"}
                fontVariantNumeric="tabular-nums"
              >
                {column.cell(row)}
              </Table.Cell>
            ))}
          </Table.Row>
        ))}
      </Table.Body>
    </Table.Root>
  );
}

const mono = (text: string) => (
  <Text as="span" fontFamily="mono" fontSize="12px" color="fg.muted">
    {text}
  </Text>
);

export function FailuresView({ rows }: TableViewProps) {
  return (
    <RowsTable
      rows={rows.main ?? []}
      rowKey={(row) => `${rowText(row, "category")}|${rowText(row, "operation")}`}
      columns={[
        { header: "Category", cell: (row) => rowText(row, "category") },
        { header: "Operation", cell: (row) => mono(rowText(row, "operation")) },
        {
          header: "First seen",
          cell: (row) => formatBucket({ value: row.first_seen, granularitySeconds: 60 }),
        },
        { header: "Count", numeric: true, cell: (row) => formatCount(rowNumber(row, "failures")) },
      ]}
    />
  );
}

export function ScenariosView({ rows }: TableViewProps) {
  const summary = rows.summary?.[0];
  const runs = rowNumber(summary, "runs");
  const passed = rowNumber(summary, "passed");
  const suites = (rows.suites ?? []).map((row) => ({
    suite: rowText(row, "suite"),
    pass_rate: rowNumber(row, "runs") > 0 ? rowNumber(row, "passed") / rowNumber(row, "runs") : 0,
  }));
  return (
    <VStack align="stretch" gap={3}>
      <HStack gap={2} alignItems="baseline">
        <Text fontSize="22px" fontWeight="semibold">
          {formatRatio(runs > 0 ? passed / runs : 0, 0)}
        </Text>
        <Text fontSize="12px" color="fg.muted">
          {formatCount(passed)} / {formatCount(runs)} runs passing
        </Text>
      </HStack>
      <RankingList rows={suites} unit="ratio" color={CHART_COLORS.accent} />
    </VStack>
  );
}

export function GatewayView({ rows }: TableViewProps) {
  return <RankingList rows={rows.main ?? []} unit="usd" />;
}

const AGENT_LABELS: Readonly<Record<string, string>> = {
  "claude-code": "Claude Code",
  claude_code: "Claude Code",
  cursor: "Cursor",
  codex: "Codex",
};

export function CodingAgentsView({ rows }: TableViewProps) {
  const trend = rows.trend ?? [];
  const pointsOf = (agent: string) =>
    trend.filter((row) => rowText(row, "agent") === agent).map((row) => rowNumber(row, "sessions"));
  return (
    <RowsTable
      rows={rows.agents ?? []}
      rowKey={(row) => rowText(row, "agent")}
      columns={[
        {
          header: "Agent",
          cell: (row) => AGENT_LABELS[rowText(row, "agent").toLowerCase()] ?? rowText(row, "agent"),
        },
        {
          header: "Sessions",
          numeric: true,
          cell: (row) => formatCount(rowNumber(row, "sessions")),
        },
        { header: "Tokens", numeric: true, cell: (row) => formatCount(rowNumber(row, "tokens")) },
        { header: "Cost", numeric: true, cell: (row) => formatUsd(rowNumber(row, "cost")) },
        {
          header: "Success",
          numeric: true,
          cell: (row) => formatRatio(rowNumber(row, "success_rate"), 0),
        },
        {
          header: "Trend",
          numeric: true,
          cell: (row) => <Sparkline points={pointsOf(rowText(row, "agent"))} />,
        },
      ]}
    />
  );
}

function traceStatus(row: BlockRow): { label: string; palette: string } {
  if (rowNumber(row, "has_error") > 0) return { label: "error", palette: "red" };
  const p95 = rowNumber(row, "p95_latency");
  if (p95 > 0 && rowNumber(row, "latency_ms") >= p95) return { label: "slow", palette: "orange" };
  return { label: "ok", palette: "green" };
}

function FeedbackMark({ feedback }: { feedback: string }) {
  if (feedback === "up") return <ThumbsUp size={13} color="var(--chakra-colors-green-fg)" />;
  if (feedback === "down") return <ThumbsDown size={13} color="var(--chakra-colors-red-fg)" />;
  return (
    <Text as="span" color="fg.muted">
      -
    </Text>
  );
}

export function ImpactfulTracesView({ rows }: TableViewProps) {
  return (
    <RowsTable
      rows={rows.main ?? []}
      rowKey={(row) => rowText(row, "trace_id")}
      columns={[
        { header: "Trace", cell: (row) => mono(rowText(row, "trace_id")) },
        { header: "Operation", cell: (row) => mono(rowText(row, "operation")) },
        {
          header: "Status",
          cell: (row) => {
            const status = traceStatus(row);
            return <Badge colorPalette={status.palette}>{status.label}</Badge>;
          },
        },
        { header: "Latency", numeric: true, cell: (row) => formatMs(rowNumber(row, "latency_ms")) },
        { header: "Cost", numeric: true, cell: (row) => formatUsd(rowNumber(row, "cost")) },
        { header: "Feedback", cell: (row) => <FeedbackMark feedback={rowText(row, "feedback")} /> },
        { header: "Impact", numeric: true, cell: (row) => Math.round(rowNumber(row, "impact")) },
      ]}
    />
  );
}
