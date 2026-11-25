import { Card } from "@langwatch/design-system/card";
import { EmptyValue } from "@langwatch/design-system/empty-value";
import { FormattedDate } from "@langwatch/design-system/formatted-date";
import { Badge, Box, HStack, Text } from "@langwatch/design-system/primitives";
import { ArrowUpRight } from "lucide-react";
import type { ReactNode } from "react";

import { formatDuration } from "../../../../model/ops-formatters.ts";
import { replayStateColor } from "../elements/replay-state-badge.tsx";

export interface ReplayHistoryEntryView {
  runId: string;
  description: string;
  startedAt: string;
  completedAt: string | null;
  state: "completed" | "failed" | "cancelled";
}

/** The latest replay summary, with routing supplied by the app shell. */
export function ReplayHistorySection({
  latestEntry,
  onOpenReplay,
  renderRunLink,
}: {
  latestEntry: ReplayHistoryEntryView | undefined;
  onOpenReplay: () => void;
  renderRunLink: (runId: string, content: ReactNode) => ReactNode;
}) {
  return (
    <Card padding="none">
      <HStack
        paddingX={4}
        paddingTop={3}
        paddingBottom={2}
        cursor="pointer"
        _hover={{ color: "orange.fg" }}
        transition="color 0.1s"
        onClick={onOpenReplay}
      >
        <Text textStyle="xs" fontWeight="medium" color="fg.muted">
          Latest Replay
        </Text>
        <ArrowUpRight size={10} />
      </HStack>
      <Box paddingX={4} paddingBottom={4}>
        {latestEntry ? (
          renderRunLink(
            latestEntry.runId,
            <HStack gap={3} cursor="pointer" _hover={{ opacity: 0.8 }} transition="opacity 0.1s">
              <Badge size="sm" variant="subtle" colorPalette={replayStateColor(latestEntry.state)}>
                {latestEntry.state}
              </Badge>
              <Text textStyle="xs" truncate maxWidth="240px">
                {latestEntry.description || "—"}
              </Text>
              <Text textStyle="xs" color="fg.muted">
                {formatDuration(latestEntry.startedAt, latestEntry.completedAt)}
              </Text>
              <Text textStyle="xs" color="fg.muted" whiteSpace="nowrap">
                {latestEntry.completedAt ? (
                  <FormattedDate value={latestEntry.completedAt} display="datetime" />
                ) : (
                  <EmptyValue />
                )}
              </Text>
            </HStack>,
          )
        ) : (
          <Text textStyle="xs" color="fg.muted">
            No replay history
          </Text>
        )}
      </Box>
    </Card>
  );
}
