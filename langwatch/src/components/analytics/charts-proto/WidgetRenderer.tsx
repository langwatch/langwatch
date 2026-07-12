/**
 * charts-proto — the morphing renderer (PROTOTYPE).
 *
 * One presentational component that renders the SAME stubbed result as a table,
 * bar, line, or single-stat. Swapping the visualization re-paints the same data
 * — this is the "live chart morphing" the prototype is built to demonstrate.
 *
 * A thin build over Recharts primitives (mirroring how the real CustomGraph maps
 * chart types) — but it takes shaped rows as PROPS instead of self-fetching, so
 * it runs entirely on stubbed data. Colors come from the app's validated
 * per-entity palette (`getHexColorForString`) for visual parity.
 */
import { Box, HStack, Table, Text, VStack } from "@chakra-ui/react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { TrendingDown, TrendingUp } from "react-feather";
import { aggAlias, type WidgetSpec } from "./model";
import {
  aggUnit,
  formatAggValue,
  formatCompactInt,
  type StubResult,
} from "./stubData";

const GRID_STROKE = "color-mix(in srgb, currentColor 12%, transparent)";
const AXIS_TICK = { fontSize: 11, fill: "currentColor", opacity: 0.55 };
const MAX_LINE_SERIES = 6;

interface Props {
  spec: WidgetSpec;
  result: StubResult;
  height: number;
}

export function WidgetRenderer({ spec, result, height }: Props) {
  switch (spec.visualization) {
    case "table":
      return <TableViz result={result} height={height} />;
    case "bar":
      return <BarViz result={result} height={height} />;
    case "line":
      return <LineViz result={result} height={height} />;
    case "stat":
      return <StatViz result={result} height={height} />;
  }
}

// ── Table ───────────────────────────────────────────────────────────────────
function TableViz({ result, height }: { result: StubResult; height: number }) {
  const { columns, groups } = result;
  return (
    <Box overflowY="auto" overflowX="auto" maxHeight={`${height}px`} width="100%">
      <Table.Root size="sm" stickyHeader interactive>
        <Table.Header>
          <Table.Row>
            {columns.map((col) => (
              <Table.ColumnHeader
                key={col.key}
                textAlign={col.kind === "metric" ? "end" : "start"}
                whiteSpace="nowrap"
                color="fg.muted"
                fontWeight="600"
              >
                {col.label}
                {col.kind === "metric" && col.agg && aggUnit(col.agg) ? (
                  <Text as="span" color="fg.subtle" fontWeight="400">
                    {" "}
                    ({aggUnit(col.agg)})
                  </Text>
                ) : null}
              </Table.ColumnHeader>
            ))}
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {groups.map((g) => (
            <Table.Row key={g.key}>
              {columns.map((col, ci) => {
                if (col.kind === "dimension") {
                  const isFirst = ci === 0;
                  return (
                    <Table.Cell key={col.key} whiteSpace="nowrap">
                      <HStack gap={2}>
                        {isFirst && (
                          <Box
                            width="8px"
                            height="8px"
                            borderRadius="full"
                            background={g.color}
                            flexShrink={0}
                          />
                        )}
                        <Text>{g.dims[col.key] ?? "—"}</Text>
                      </HStack>
                    </Table.Cell>
                  );
                }
                return (
                  <Table.Cell
                    key={col.key}
                    textAlign="end"
                    fontVariantNumeric="tabular-nums"
                    whiteSpace="nowrap"
                  >
                    {col.agg ? formatAggValue(col.agg, g.values[col.key] ?? 0) : "—"}
                  </Table.Cell>
                );
              })}
            </Table.Row>
          ))}
        </Table.Body>
      </Table.Root>
    </Box>
  );
}

// ── Bar (horizontal, sorted — New-Relic FACET style) ────────────────────────
function BarViz({ result, height }: { result: StubResult; height: number }) {
  const { groups, primaryAgg } = result;
  const key = aggAlias(primaryAgg, 0);
  const data = groups.slice(0, 12).map((g) => ({
    name: g.label,
    color: g.color,
    value: g.values[key] ?? 0,
  }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 4, right: 44, bottom: 4, left: 8 }}
      >
        <CartesianGrid horizontal={false} stroke={GRID_STROKE} />
        <XAxis
          type="number"
          tick={AXIS_TICK}
          tickFormatter={(v: number) => formatAggValue(primaryAgg, v)}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          type="category"
          dataKey="name"
          width={130}
          tick={AXIS_TICK}
          axisLine={false}
          tickLine={false}
          interval={0}
        />
        <Tooltip
          cursor={{ fill: "color-mix(in srgb, currentColor 6%, transparent)" }}
          content={<ChartTip agg={primaryAgg} />}
        />
        <Bar dataKey="value" radius={[0, 4, 4, 0]} isAnimationActive animationDuration={450}>
          {data.map((d) => (
            <Cell key={d.name} fill={d.color} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Line (time series, one series per group) ────────────────────────────────
function LineViz({ result, height }: { result: StubResult; height: number }) {
  const { buckets, groups, primaryAgg } = result;
  const series = groups.slice(0, MAX_LINE_SERIES);
  const data = buckets.map((b) => {
    const row: Record<string, number | string> = { label: b.label };
    for (const g of series) row[g.key] = b.byGroup[g.key] ?? 0;
    return row;
  });

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 8 }}>
        <CartesianGrid stroke={GRID_STROKE} />
        <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} minTickGap={24} />
        <YAxis
          tick={AXIS_TICK}
          axisLine={false}
          tickLine={false}
          width={48}
          tickFormatter={(v: number) => formatAggValue(primaryAgg, v)}
        />
        <Tooltip content={<ChartTip agg={primaryAgg} multi series={series} />} />
        {series.map((g) => (
          <Line
            key={g.key}
            type="monotone"
            dataKey={g.key}
            name={g.label}
            stroke={g.color}
            strokeWidth={2}
            dot={false}
            isAnimationActive
            animationDuration={450}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

// ── Single stat (billboard) ─────────────────────────────────────────────────
function StatViz({ result, height }: { result: StubResult; height: number }) {
  const { total, primaryAgg } = result;
  const up = total.deltaPct >= 0;
  const spark = total.spark.map((v, i) => ({ i, v }));
  const unit = aggUnit(primaryAgg);
  // formatAggValue already embeds $ and ms/s; only tokens need a trailing unit.
  const showUnit = unit === "tok" || unit === "tok/s";

  return (
    <VStack align="stretch" justify="center" height={`${height}px`} gap={1} paddingX={2}>
      <HStack align="baseline" gap={2}>
        <Text fontSize="4xl" fontWeight="700" lineHeight="1" fontVariantNumeric="tabular-nums">
          {formatAggValue(primaryAgg, total.value)}
        </Text>
        {showUnit ? (
          <Text fontSize="md" color="fg.muted">
            {unit}
          </Text>
        ) : null}
      </HStack>
      <HStack gap={1} color={up ? "green.500" : "red.500"} fontSize="sm" fontWeight="500">
        {up ? <TrendingUp size={15} /> : <TrendingDown size={15} />}
        <Text>
          {up ? "+" : ""}
          {total.deltaPct}%
        </Text>
        <Text color="fg.subtle" fontWeight="400">
          vs previous period
        </Text>
      </HStack>
      <Box height="40px" marginTop={2}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={spark} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="sparkfill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#ED8926" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#ED8926" stopOpacity={0} />
              </linearGradient>
            </defs>
            <Area
              type="monotone"
              dataKey="v"
              stroke="#ED8926"
              strokeWidth={2}
              fill="url(#sparkfill)"
              isAnimationActive
              animationDuration={450}
            />
          </AreaChart>
        </ResponsiveContainer>
      </Box>
    </VStack>
  );
}

// ── Shared tooltip ──────────────────────────────────────────────────────────
function ChartTip({
  active,
  payload,
  label,
  agg,
  multi,
  series,
}: {
  active?: boolean;
  payload?: Array<{ value: number; name?: string; color?: string; payload?: any }>;
  label?: string;
  agg: StubResult["primaryAgg"];
  multi?: boolean;
  series?: StubResult["groups"];
}) {
  if (!active || !payload?.length) return null;
  return (
    <Box
      background="bg.panel"
      borderWidth="1px"
      borderColor="border"
      borderRadius="md"
      boxShadow="md"
      paddingX={3}
      paddingY={2}
      fontSize="xs"
    >
      {label ? (
        <Text fontWeight="600" marginBottom={1}>
          {label}
        </Text>
      ) : null}
      {multi && series ? (
        payload
          .slice()
          .sort((a, b) => b.value - a.value)
          .map((p) => (
            <HStack key={p.name} gap={2} justify="space-between">
              <HStack gap={1.5}>
                <Box width="8px" height="8px" borderRadius="full" background={p.color} />
                <Text color="fg.muted">{p.name}</Text>
              </HStack>
              <Text fontVariantNumeric="tabular-nums">{formatAggValue(agg, p.value)}</Text>
            </HStack>
          ))
      ) : (
        <HStack gap={2} justify="space-between">
          <HStack gap={1.5}>
            <Box
              width="8px"
              height="8px"
              borderRadius="full"
              background={payload[0]?.payload?.color ?? payload[0]?.color ?? "#ED8926"}
            />
            <Text color="fg.muted">{payload[0]?.payload?.name ?? "Value"}</Text>
          </HStack>
          <Text fontVariantNumeric="tabular-nums">
            {formatAggValue(agg, payload[0]?.value ?? 0)}
          </Text>
        </HStack>
      )}
    </Box>
  );
}

export { formatCompactInt };
