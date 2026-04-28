import { Text } from "@chakra-ui/react";
import type { TraceListItem } from "../../../../../types/trace";
import { formatDuration, formatTokens } from "../../../../../utils/formatters";
import { MonoCell } from "../../../MonoCell";
import { StatusIndicator } from "../../../StatusRow";
import type { CellDef } from "../../types";

const dash = "—";

export const StatusCell: CellDef<TraceListItem> = {
  id: "status",
  label: "Status",
  render: ({ row }) => <StatusIndicator status={row.status} />,
};

export const TtftCell: CellDef<TraceListItem> = {
  id: "ttft",
  label: "TTFT",
  render: ({ row }) => (
    <MonoCell>{row.ttft != null ? formatDuration(row.ttft) : dash}</MonoCell>
  ),
  renderComfortable: ({ row }) => (
    <Text textStyle="sm" color="fg.muted" textAlign="right" fontFamily="mono">
      {row.ttft != null ? formatDuration(row.ttft) : dash}
    </Text>
  ),
};

export const UserIdCell: CellDef<TraceListItem> = {
  id: "userId",
  label: "User ID",
  render: ({ row }) => (
    <MonoCell color="fg.subtle" truncate>
      {row.userId || dash}
    </MonoCell>
  ),
  renderComfortable: ({ row }) => (
    <Text textStyle="sm" color="fg.muted" truncate fontFamily="mono">
      {row.userId || dash}
    </Text>
  ),
};

export const ConversationIdCell: CellDef<TraceListItem> = {
  id: "conversationId",
  label: "Conversation ID",
  render: ({ row }) => (
    <MonoCell color="fg.subtle" truncate>
      {row.conversationId || dash}
    </MonoCell>
  ),
  renderComfortable: ({ row }) => (
    <Text textStyle="sm" color="fg.muted" truncate fontFamily="mono">
      {row.conversationId || dash}
    </Text>
  ),
};

const ORIGIN_LABEL: Record<TraceListItem["origin"], string> = {
  application: "App",
  simulation: "Sim",
  evaluation: "Eval",
};

export const OriginCell: CellDef<TraceListItem> = {
  id: "origin",
  label: "Origin",
  render: ({ row }) => (
    <Text textStyle="xs" color="fg.muted">
      {ORIGIN_LABEL[row.origin] ?? row.origin}
    </Text>
  ),
};

export const TokensInCell: CellDef<TraceListItem> = {
  id: "tokensIn",
  label: "Tokens In",
  render: ({ row }) => (
    <MonoCell>{row.inputTokens != null ? formatTokens(row.inputTokens) : dash}</MonoCell>
  ),
  renderComfortable: ({ row }) => (
    <Text textStyle="sm" color="fg.muted" textAlign="right" fontFamily="mono">
      {row.inputTokens != null ? formatTokens(row.inputTokens) : dash}
    </Text>
  ),
};

export const TokensOutCell: CellDef<TraceListItem> = {
  id: "tokensOut",
  label: "Tokens Out",
  render: ({ row }) => (
    <MonoCell>{row.outputTokens != null ? formatTokens(row.outputTokens) : dash}</MonoCell>
  ),
  renderComfortable: ({ row }) => (
    <Text textStyle="sm" color="fg.muted" textAlign="right" fontFamily="mono">
      {row.outputTokens != null ? formatTokens(row.outputTokens) : dash}
    </Text>
  ),
};
