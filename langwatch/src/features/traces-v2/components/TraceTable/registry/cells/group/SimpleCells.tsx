import { HStack, Text } from "@chakra-ui/react";
import {
  formatCost,
  formatDuration,
  formatTokens,
} from "../../../../../utils/formatters";
import { MonoCell } from "../../../MonoCell";
import { StatusDot } from "../../../StatusRow";
import type { CellDef } from "../../types";
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

export const CostCell: CellDef<TraceGroup> = {
  id: "cost",
  label: "Cost",
  render: ({ row }) => <MonoCell>{formatCost(row.totalCost)}</MonoCell>,
  renderComfortable: ({ row }) => (
    <Text textStyle="sm" color="fg.muted" textAlign="right">
      {formatCost(row.totalCost)}
    </Text>
  ),
};

export const TokensCell: CellDef<TraceGroup> = {
  id: "tokens",
  label: "Tokens",
  render: ({ row }) => <MonoCell>{formatTokens(row.totalTokens)}</MonoCell>,
  renderComfortable: ({ row }) => (
    <Text textStyle="sm" color="fg.muted" textAlign="right">
      {formatTokens(row.totalTokens)}
    </Text>
  ),
};

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
