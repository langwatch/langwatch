/**
 * The tile and table block views of the Flight Deck: Status, Cost efficiency,
 * Failure intelligence, Scenario results, Gateway routing, Your coding agents
 * and Most impactful traces. Each reads the rows of its own statements only.
 */

import { Box, chakra, HStack, SimpleGrid, Text, VStack } from "@chakra-ui/react";
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
import { RankingList, Sparkline } from "./block-charts.tsx";

export interface TableViewProps {
  readonly rows: BlockRows;
  readonly granularitySeconds: number;
}

/** Whether a rise is good news, bad news or neither. */
type Polarity = "upGood" | "upBad" | "neutral";

/** The delta line's colour: neutral grey, otherwise green for good news, red for bad. */
function colorFor({ neutral, good }: { neutral: boolean; good: boolean }): string {
  if (neutral) return "gray.400";
  return good ? "green.solid" : "red.solid";
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
    <HStack gap={0.5} marginTop={0.5} fontSize="11px" fontWeight="medium" color={color}>
      <Icon size={12} />
      {formatDelta(delta)}
      <Text as="span" color="gray.400">
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
    <Box
      borderWidth="1px"
      borderColor="border"
      borderRadius="lg"
      background="bg.muted/40"
      paddingX={3}
      paddingY={2.5}
      data-testid="status-tile"
    >
      <Text fontSize="11px" fontWeight="medium" color="fg.subtle">
        {label}
      </Text>
      <Text
        marginTop={0.5}
        fontSize="20px"
        lineHeight="24px"
        fontWeight="semibold"
        letterSpacing="tight"
        fontVariantNumeric="tabular-nums"
      >
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
    <Box borderRadius="md" background="bg.muted/50" paddingX={2} paddingY={1.5}>
      <Text fontSize="10px" color="gray.400">
        {label}
      </Text>
      <Text fontSize="14px" fontWeight="semibold" fontVariantNumeric="tabular-nums">
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
    <VStack align="stretch" gap={0}>
      <SimpleGrid columns={3} gap={2} marginBottom={3}>
        <MiniStat label="Cost / success" value={formatUsd(successes > 0 ? cost / successes : 0)} />
        <MiniStat label="Tokens in" value={formatCount(rowNumber(summary, "tokens_in"))} />
        <MiniStat label="Tokens out" value={formatCount(rowNumber(summary, "tokens_out"))} />
      </SimpleGrid>
      <Text marginBottom={1} fontSize="11px" fontWeight="medium" color="fg.subtle">
        Highest-cost models
      </Text>
      <RankingList rows={rows.models ?? []} unit="usd" />
    </VStack>
  );
}

interface Column {
  readonly header: string;
  readonly align?: "start" | "end" | "center";
  readonly cell: (row: BlockRow) => ReactNode;
}

/** The prototype's compact table: sentence-case grey headers, hairline row rules. */
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
    <chakra.table width="full" fontSize="11.5px" borderCollapse="collapse">
      <chakra.thead>
        <chakra.tr color="gray.400">
          {columns.map((column) => (
            <chakra.th
              key={column.header}
              textAlign={column.align ?? "start"}
              fontWeight="medium"
              paddingBottom={1}
            >
              {column.header}
            </chakra.th>
          ))}
        </chakra.tr>
      </chakra.thead>
      <chakra.tbody>
        {rows.map((row) => (
          <chakra.tr key={rowKey(row)} borderTopWidth="1px" borderColor="border/60">
            {columns.map((column) => (
              <chakra.td
                key={column.header}
                textAlign={column.align ?? "start"}
                paddingY={1}
                paddingRight={2}
                _last={{ paddingRight: 0 }}
                fontVariantNumeric="tabular-nums"
              >
                {column.cell(row)}
              </chakra.td>
            ))}
          </chakra.tr>
        ))}
      </chakra.tbody>
    </chakra.table>
  );
}

const mono = (text: string, color = "fg.subtle") => (
  <Text as="span" fontFamily="mono" fontSize="10.5px" color={color}>
    {text}
  </Text>
);

const faint = (text: string) => (
  <Text as="span" color="gray.400">
    {text}
  </Text>
);

const strong = (text: ReactNode, weight: "medium" | "semibold" = "medium") => (
  <Text as="span" fontWeight={weight}>
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
          cell: (row) => faint(formatBucket({ value: row.first_seen, granularitySeconds: 60 })),
        },
        {
          header: "Count",
          align: "end",
          cell: (row) => strong(formatCount(rowNumber(row, "failures"))),
        },
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
    <VStack align="stretch" gap={0}>
      <HStack gap={2} alignItems="baseline" marginBottom={3}>
        <Text fontSize="22px" fontWeight="semibold" fontVariantNumeric="tabular-nums">
          {formatRatio(runs > 0 ? passed / runs : 0, 0)}
        </Text>
        <Text fontSize="11px" color="fg.subtle">
          {formatCount(passed)} / {formatCount(runs)} runs passing
        </Text>
      </HStack>
      <RankingList rows={suites} unit="ratio" />
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
          align: "end",
          cell: (row) => formatCount(rowNumber(row, "sessions")),
        },
        { header: "Tokens", align: "end", cell: (row) => formatCount(rowNumber(row, "tokens")) },
        {
          header: "Cost",
          align: "end",
          cell: (row) => strong(formatUsd(rowNumber(row, "cost")), "semibold"),
        },
        {
          header: "Success",
          align: "end",
          cell: (row) => formatRatio(rowNumber(row, "success_rate"), 0),
        },
        {
          header: "Trend",
          align: "end",
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

/** The prototype's status pill: the tone at a tenth for the ground, full for the word. */
function StatusPill({ row }: { row: BlockRow }) {
  const { label, palette } = traceStatus(row);
  return (
    <Box
      as="span"
      display="inline-flex"
      borderRadius="md"
      paddingX={1.5}
      paddingY={0.5}
      fontSize="11px"
      fontWeight="medium"
      background={`${palette}.solid/10`}
      color={`${palette}.solid`}
    >
      {label}
    </Box>
  );
}

function FeedbackMark({ feedback }: { feedback: string }) {
  if (feedback === "up") return <ThumbsUp size={13} color="var(--chakra-colors-green-solid)" />;
  if (feedback === "down") return <ThumbsDown size={13} color="var(--chakra-colors-red-solid)" />;
  return faint("-");
}

export function ImpactfulTracesView({ rows }: TableViewProps) {
  return (
    <RowsTable
      rows={rows.main ?? []}
      rowKey={(row) => rowText(row, "trace_id")}
      columns={[
        { header: "Trace", cell: (row) => mono(rowText(row, "trace_id"), "teal.solid") },
        { header: "Operation", cell: (row) => mono(rowText(row, "operation")) },
        { header: "Status", cell: (row) => <StatusPill row={row} /> },
        { header: "Latency", align: "end", cell: (row) => formatMs(rowNumber(row, "latency_ms")) },
        { header: "Cost", align: "end", cell: (row) => formatUsd(rowNumber(row, "cost")) },
        {
          header: "Feedback",
          align: "center",
          cell: (row) => <FeedbackMark feedback={rowText(row, "feedback")} />,
        },
        {
          header: "Impact",
          align: "end",
          cell: (row) => strong(Math.round(rowNumber(row, "impact")), "semibold"),
        },
      ]}
    />
  );
}
