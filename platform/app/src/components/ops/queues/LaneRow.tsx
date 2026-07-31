import { Badge, Button, HStack, Table, Text } from "@chakra-ui/react";
import { formatMs, formatTimeAgo } from "~/components/ops/shared/formatters";
import type { LaneInfo } from "~/server/app-layer/ops/types";
import {
  LANE_STATUS_COLORS,
  LANE_STATUS_LABELS,
  laneStatus,
} from "./laneFilters";

const EM_DASH = "—";

/** A lease's remaining time, else the backoff deadline, else nothing holds it. */
function holdColumn(lane: LaneInfo): string {
  if (lane.leaseRemainingMs !== null) return formatMs(lane.leaseRemainingMs);
  if (lane.readyAtMs !== null) return formatTimeAgo(lane.readyAtMs);
  return EM_DASH;
}

export function LaneRow({
  lane,
  hasAccess,
  isUnparking,
  onOpen,
  onUnpark,
  onDrain,
}: {
  lane: LaneInfo;
  hasAccess: boolean;
  isUnparking: boolean;
  onOpen: () => void;
  onUnpark: () => void;
  onDrain: () => void;
}) {
  const status = laneStatus(lane);

  return (
    <Table.Row cursor="pointer" _hover={{ bg: "bg.subtle" }} onClick={onOpen}>
      <Table.Cell>
        <Text
          textStyle="xs"
          fontFamily="mono"
          truncate
          title={lane.parkReason ?? lane.laneId}
        >
          {lane.laneId}
        </Text>
      </Table.Cell>
      <Table.Cell>
        <Text textStyle="xs" color="fg.muted" truncate>
          {lane.laneName ?? EM_DASH}
        </Text>
      </Table.Cell>
      <Table.Cell textAlign="end">
        <Text textStyle="xs" fontFamily="mono">
          {lane.pendingJobs}
        </Text>
      </Table.Cell>
      <Table.Cell textAlign="end">
        <Text
          textStyle="xs"
          fontFamily="mono"
          color={lane.attempts > 0 ? "orange.500" : "fg.muted"}
        >
          {lane.attempts > 0 ? lane.attempts : EM_DASH}
        </Text>
      </Table.Cell>
      <Table.Cell>
        <Text textStyle="xs" color="fg.muted">
          {holdColumn(lane)}
        </Text>
      </Table.Cell>
      <Table.Cell>
        <Badge
          size="xs"
          colorPalette={LANE_STATUS_COLORS[status]}
          variant="subtle"
        >
          {LANE_STATUS_LABELS[status]}
        </Badge>
      </Table.Cell>
      {hasAccess && (
        <Table.Cell onClick={(e) => e.stopPropagation()}>
          <HStack gap={1}>
            {lane.isParked && (
              <Button
                variant="outline"
                size="2xs"
                colorPalette="green"
                onClick={onUnpark}
                loading={isUnparking}
              >
                Unpark
              </Button>
            )}
            <Button
              variant="outline"
              size="2xs"
              colorPalette="red"
              onClick={onDrain}
            >
              Drain
            </Button>
          </HStack>
        </Table.Cell>
      )}
    </Table.Row>
  );
}
