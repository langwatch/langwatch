import { Card, HStack, Table, Text } from "@chakra-ui/react";
import type { LatencyWindowPercentiles, LatencyWindows } from "@langwatch/ops-contract";
import { formatCount, formatMs } from "@langwatch/ops-web";

const WINDOW_ROWS: Array<{ key: keyof LatencyWindows; label: string }> = [
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
    <Table.Cell textAlign="end">
      <Text textStyle="xs" fontFamily="mono" color={window ? undefined : "fg.muted"}>
        {window ? formatMs(pick(window)) : "—"}
      </Text>
    </Table.Cell>
  );
}

/**
 * Processing-time percentiles per real time window, from the completion
 * histograms — the honest companion to the strip's last-200-jobs tiles. A
 * quiet window shows a dash, never a fabricated zero; "All time" means since
 * latency history began recording.
 */
export function LatencyWindowsCard({ windows }: { windows: LatencyWindows | null }) {
  if (!windows) return null;

  return (
    <Card.Root>
      <Card.Body padding={0}>
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
            {windows.allTime
              ? ` · ${formatCount(windows.allTime.count)} completions all time`
              : ""}
          </Text>
        </HStack>
        <Table.Root size="sm" variant="line">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>Window</Table.ColumnHeader>
              <Table.ColumnHeader textAlign="end">P50</Table.ColumnHeader>
              <Table.ColumnHeader textAlign="end">P99</Table.ColumnHeader>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {WINDOW_ROWS.map((row) => (
              <Table.Row key={row.key}>
                <Table.Cell>
                  <Text textStyle="xs" fontWeight="medium">
                    {row.label}
                  </Text>
                </Table.Cell>
                <PercentileCell window={windows[row.key]} pick={(w) => w.p50Ms} />
                <PercentileCell window={windows[row.key]} pick={(w) => w.p99Ms} />
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      </Card.Body>
    </Card.Root>
  );
}
