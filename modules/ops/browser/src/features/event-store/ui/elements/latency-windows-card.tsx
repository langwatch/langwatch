import { Card } from "@langwatch/design-system/card";
import { InlineCode } from "@langwatch/design-system/inline-code";
import { ListTable } from "@langwatch/design-system/list-table";
import { HStack, Text } from "@langwatch/design-system/primitives";
import type { LatencyWindowPercentiles, LatencyWindows } from "@langwatch/ops-contract";

import { formatCount, formatMs } from "../../../../model/ops-formatters.ts";

const WINDOW_ROWS: { key: keyof LatencyWindows; label: string }[] = [
  { key: "hour", label: "Last hour" },
  { key: "day", label: "Last 24 hours" },
  { key: "week", label: "Last 7 days" },
  { key: "allTime", label: "All time" },
];

function PercentileCell({
  window,
  pick,
}: {
  window: LatencyWindowPercentiles | null;
  pick: (w: LatencyWindowPercentiles) => number;
}) {
  return (
    <ListTable.Cell align="end">
      <InlineCode variant="neutral">{window ? formatMs(pick(window)) : "—"}</InlineCode>
    </ListTable.Cell>
  );
}

/**
 * Processing-time percentiles per real time window, from the completion
 * histograms - the honest companion to the strip's last-200-jobs tiles. A
 * quiet window shows a dash, never a fabricated zero.
 */
export function LatencyWindowsCard({ windows }: { windows: LatencyWindows | null }) {
  if (!windows) return null;

  return (
    <Card padding="none">
      <HStack
        paddingX={4}
        paddingY={2.5}
        borderBottom="1px solid"
        borderBottomColor="border"
        gap={2}
      >
        <Text textStyle="sm" fontWeight="medium">
          Processing time by window
        </Text>
        <Text
          textStyle="xs"
          color="fg.muted"
          title="Computed from bucketed completion histograms, so each figure is a slight overestimate. All time counts since latency history began recording."
        >
          bucketed estimates
          {windows.allTime ? ` · ${formatCount(windows.allTime.count)} completions all time` : ""}
        </Text>
      </HStack>
      <ListTable
        density="compact"
        variant="embedded"
        scroll="x"
        scrollLabel="Processing time by window"
      >
        <ListTable.Header>
          <ListTable.Row>
            <ListTable.ColumnHeader>Window</ListTable.ColumnHeader>
            <ListTable.ColumnHeader align="end">P50</ListTable.ColumnHeader>
            <ListTable.ColumnHeader align="end">P99</ListTable.ColumnHeader>
          </ListTable.Row>
        </ListTable.Header>
        <ListTable.Body>
          {WINDOW_ROWS.map((row) => (
            <ListTable.Row key={row.key}>
              <ListTable.Cell>
                <Text textStyle="xs" fontWeight="medium">
                  {row.label}
                </Text>
              </ListTable.Cell>
              <PercentileCell window={windows[row.key]} pick={(w) => w.p50Ms} />
              <PercentileCell window={windows[row.key]} pick={(w) => w.p99Ms} />
            </ListTable.Row>
          ))}
        </ListTable.Body>
      </ListTable>
    </Card>
  );
}
