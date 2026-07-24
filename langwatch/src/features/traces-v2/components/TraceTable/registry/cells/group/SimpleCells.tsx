import { HStack, Text } from "@chakra-ui/react";
import { formatDuration } from "../../../../../utils/formatters";
import { MonoCell } from "../../../MonoCell";
import { StatusDot } from "../../../StatusRow";
import type { CellDef } from "../../types";
import { createCostCell, createTokensCell } from "../sharedSummaryCells";
import type { TraceGroup } from "./types";

export const CountCell: CellDef<TraceGroup> = {
  id: "count",
  label: "Traces",
  render: ({ row }) => <MonoCell>{row.traces.length}</MonoCell>,
  renderComfortable: ({ row }) => (
    <Text textStyle="sm" color="fg.muted" textAlign="right">
      {row.traces.length}
    </Text>
  ),
};

export const AvgDurationCell: CellDef<TraceGroup> = {
  id: "duration",
  label: "Avg Dur",
  render: ({ row }) => <MonoCell>{formatDuration(row.avgDuration)}</MonoCell>,
  renderComfortable: ({ row }) => (
    <Text textStyle="sm" color="fg.muted" textAlign="right">
      {formatDuration(row.avgDuration)}
    </Text>
  ),
};

export const CostCell = createCostCell<TraceGroup>("sm");

export const TokensCell = createTokensCell<TraceGroup>("sm");

export const ErrorsCell: CellDef<TraceGroup> = {
  id: "errors",
  label: "Errors",
  render: ({ row }) => {
    if (row.errorCount === 0) {
      return (
        <Text textStyle="xs" color="fg.subtle">
          —
        </Text>
      );
    }
    return (
      <HStack gap={1} justifyContent="flex-end">
        <StatusDot status="error" size="6px" />
        <MonoCell color="red.fg">{row.errorCount}</MonoCell>
      </HStack>
    );
  },
  renderComfortable: ({ row }) => {
    if (row.errorCount === 0) {
      return (
        <Text textStyle="sm" color="fg.subtle" textAlign="right">
          —
        </Text>
      );
    }
    return (
      <HStack gap={2} justifyContent="flex-end">
        <StatusDot status="error" size="8px" />
        <Text textStyle="sm" color="red.fg" fontWeight="500">
          {row.errorCount}
        </Text>
      </HStack>
    );
  },
};
