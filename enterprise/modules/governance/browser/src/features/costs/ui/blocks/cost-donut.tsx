// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import { getHexColorForString } from "@langwatch/design-system/rotating-colors";
import { type ReactNode, useMemo } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import { CHART_TOOLTIP_CONTENT, CHART_TOOLTIP_LABEL } from "../../model/chart-theme.ts";
import { fmtMoney } from "../../model/cost-figure-format.ts";
import { type RankRow } from "../../model/sample-series.ts";
import { EmptyPanel } from "./cost-chart-parts.tsx";

/**
 * Donut with the breakdown listed beside it. The list carries the figures, so
 * the ring itself needs no labels.
 */
export function CostDonut({
  rows,
  empty,
}: {
  rows: RankRow[] | null;
  /** This panel's own empty state. See `costPanelEmpty`. */
  empty?: (unanswered: boolean) => ReactNode;
}) {
  const shown = useMemo(
    () => [...(rows ?? [])].toSorted((a, b) => b.value - a.value).slice(0, 8),
    [rows],
  );
  const total = shown.reduce((sum, row) => sum + row.value, 0);

  if (rows === null) return <EmptyPanel height="220px" unanswered empty={empty} />;
  // A ring of nothing is not a ring. Zero total covers both no rows at all
  // and rows that all came to zero, and neither draws.
  if (total === 0) return <EmptyPanel height="220px" unanswered={false} empty={empty} />;

  return (
    <HStack align="center" gap={4}>
      {/* Narrower than the legend beside it on purpose. The ring carries the
          shape of the split and needs no more than this to do it; the names
          are what a reader has to actually read, and every pixel here is one
          the labels lose. */}
      <Box width="120px" height="180px" flexShrink={0}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={shown}
              dataKey="value"
              nameKey="label"
              innerRadius="58%"
              outerRadius="88%"
              paddingAngle={1}
              isAnimationActive={false}
              stroke="none"
            >
              {shown.map((row) => (
                <Cell key={row.key} fill={getHexColorForString(row.label)} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value) => fmtMoney(Number(value))}
              contentStyle={CHART_TOOLTIP_CONTENT}
              labelStyle={CHART_TOOLTIP_LABEL}
            />
          </PieChart>
        </ResponsiveContainer>
      </Box>
      {/* `minWidth={0}` here as well as on the rows: this VStack is itself a
          flex item, and its default minimum is the width of its widest row.
          Without it the legend refuses to narrow and pushes its own right
          edge outside the panel, which is what cut the percentages off. */}
      <VStack align="stretch" gap={1.5} flex="1" minWidth={0} fontSize="xs">
        {shown.map((row) => (
          <HStack key={row.key} gap={2} minWidth={0}>
            <Box
              width="8px"
              height="8px"
              borderRadius="full"
              flexShrink={0}
              backgroundColor={getHexColorForString(row.label)}
            />
            {/* `minWidth={0}` is what makes the truncation actually happen. A
                flex item's default minimum is its content width, so without
                this the label refuses to shrink and shoves the two figures
                past the panel's right edge — which is how "52%" came out as
                "52" and "3%" lost half of itself. */}
            <Text truncate title={row.label} flex="1" minWidth={0}>
              {row.label}
            </Text>
            <Text fontVariantNumeric="tabular-nums" flexShrink={0}>
              {fmtMoney(row.value)}
            </Text>
            {/* Wide enough for "100%", which is what a single-agent tenant
                shows on its first day. */}
            <Text
              color="fg.muted"
              flex="0 0 38px"
              flexShrink={0}
              textAlign="right"
              fontVariantNumeric="tabular-nums"
            >
              {Math.round((row.value / total) * 100)}%
            </Text>
          </HStack>
        ))}
      </VStack>
    </HStack>
  );
}
