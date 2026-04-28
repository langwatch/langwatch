import { HStack, Text } from "@chakra-ui/react";
import {
  abbreviateModel,
  formatCost,
  formatDuration,
  formatTokens,
} from "../../../../../utils/formatters";
import type { TraceStatus } from "../../../../../types/trace";
import { MonoCell } from "../../../MonoCell";
import { StatusDot, StatusIndicator } from "../../../StatusRow";
import type { ConversationGroup } from "../../../conversationGroups";
import type { CellDef } from "../../types";

const STATUS_HEALTH_LABELS: Record<TraceStatus, string> = {
  ok: "Healthy",
  warning: "Warnings",
  error: "Errors",
};

export const DurationCell: CellDef<ConversationGroup> = {
  id: "duration",
  label: "Duration",
  render: ({ row }) => <MonoCell>{formatDuration(row.totalDuration)}</MonoCell>,
  renderComfortable: ({ row }) => (
    <Text textStyle="sm" color="fg.muted" textAlign="right">
      {formatDuration(row.totalDuration)}
    </Text>
  ),
};

export const CostCell: CellDef<ConversationGroup> = {
  id: "cost",
  label: "Cost",
  render: ({ row }) => <MonoCell>{formatCost(row.totalCost)}</MonoCell>,
  renderComfortable: ({ row }) => (
    <Text textStyle="sm" color="fg.muted" textAlign="right">
      {formatCost(row.totalCost)}
    </Text>
  ),
};

export const TokensCell: CellDef<ConversationGroup> = {
  id: "tokens",
  label: "Tokens",
  render: ({ row }) => <MonoCell>{formatTokens(row.totalTokens)}</MonoCell>,
  renderComfortable: ({ row }) => (
    <Text textStyle="sm" color="fg.muted" textAlign="right">
      {formatTokens(row.totalTokens)}
    </Text>
  ),
};

export const ModelCell: CellDef<ConversationGroup> = {
  id: "model",
  label: "Model",
  render: ({ row }) => (
    <MonoCell truncate whiteSpace={undefined}>
      {row.primaryModel ? abbreviateModel(row.primaryModel) : "—"}
    </MonoCell>
  ),
  renderComfortable: ({ row }) => (
    <Text textStyle="sm" color="fg.muted" truncate>
      {row.primaryModel ? abbreviateModel(row.primaryModel) : "—"}
    </Text>
  ),
};

export const ServiceCell: CellDef<ConversationGroup> = {
  id: "service",
  label: "Service",
  render: ({ row }) => (
    <Text textStyle="sm" color="fg.subtle" truncate>
      {row.serviceName || "—"}
    </Text>
  ),
  renderComfortable: ({ row }) => (
    <Text textStyle="sm" color="fg.muted" truncate>
      {row.serviceName || "—"}
    </Text>
  ),
};

export const StatusCell: CellDef<ConversationGroup> = {
  id: "status",
  label: "Status",
  render: ({ row }) => <StatusIndicator status={row.worstStatus} />,
  renderComfortable: ({ row }) => (
    <HStack gap={2}>
      <StatusDot status={row.worstStatus} size="10px" />
      <Text textStyle="sm" color="fg.muted">
        {STATUS_HEALTH_LABELS[row.worstStatus]}
      </Text>
    </HStack>
  ),
};
