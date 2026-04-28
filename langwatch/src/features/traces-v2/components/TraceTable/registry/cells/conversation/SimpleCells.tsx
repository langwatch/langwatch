import { HStack, Text } from "@chakra-ui/react";
import type { TraceStatus } from "../../../../../types/trace";
import { abbreviateModel } from "../../../../../utils/formatters";
import type { ConversationGroup } from "../../../conversationGroups";
import { MonoCell } from "../../../MonoCell";
import { StatusDot, StatusIndicator } from "../../../StatusRow";
import type { CellDef } from "../../types";
import {
  createCostCell,
  createDurationCell,
  createTokensCell,
} from "../sharedSummaryCells";

const STATUS_HEALTH_LABELS: Record<TraceStatus, string> = {
  ok: "Healthy",
  warning: "Warnings",
  error: "Errors",
};

export const DurationCell = createDurationCell<ConversationGroup>();

export const CostCell = createCostCell<ConversationGroup>();

export const TokensCell = createTokensCell<ConversationGroup>();

export const ModelCell: CellDef<ConversationGroup> = {
  id: "model",
  label: "Model",
  render: ({ row }) => (
    <MonoCell truncate whiteSpace={undefined}>
      {row.primaryModel ? abbreviateModel(row.primaryModel) : "—"}
    </MonoCell>
  ),
  renderComfortable: ({ row }) => (
    <Text textStyle="xs" color="fg.muted" truncate>
      {row.primaryModel ? abbreviateModel(row.primaryModel) : "—"}
    </Text>
  ),
};

export const ServiceCell: CellDef<ConversationGroup> = {
  id: "service",
  label: "Service",
  render: ({ row }) => (
    <Text textStyle="xs" color="fg.subtle" truncate>
      {row.serviceName || "—"}
    </Text>
  ),
  renderComfortable: ({ row }) => (
    <Text textStyle="xs" color="fg.muted" truncate>
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
      <Text textStyle="xs" color="fg.muted">
        {STATUS_HEALTH_LABELS[row.worstStatus]}
      </Text>
    </HStack>
  ),
};
