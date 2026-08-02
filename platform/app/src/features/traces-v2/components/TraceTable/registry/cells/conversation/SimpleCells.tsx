import { HStack, Text } from "@chakra-ui/react";
import { Tooltip } from "~/components/ui/tooltip";
import type { TraceStatus } from "../../../../../types/trace";
import { formatTokens } from "../../../../../utils/formatters";
import type { ConversationGroup } from "../../../conversationGroups";
import { MonoCell } from "../../../MonoCell";
import { StatusDot, StatusIndicator } from "../../../StatusRow";
import type { CellDef } from "../../types";
import { dash } from "../dashPlaceholder";
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
      {row.primaryModel ? row.primaryModel : dash}
    </MonoCell>
  ),
  renderComfortable: ({ row }) => (
    <Text textStyle="xs" color="fg.muted" truncate>
      {row.primaryModel ? row.primaryModel : dash}
    </Text>
  ),
};

export const ServiceCell: CellDef<ConversationGroup> = {
  id: "service",
  label: "Service",
  render: ({ row }) => (
    <Text textStyle="xs" color="fg.subtle" truncate>
      {row.serviceName || dash}
    </Text>
  ),
  renderComfortable: ({ row }) => (
    <Text textStyle="xs" color="fg.muted" truncate>
      {row.serviceName || dash}
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

const CONTEXT_SIZE_EXPLANATION =
  "Largest context carried into a model call across the session.";

/**
 * Peak context size for the session: the coding-agent fold's peak when the
 * session has one, otherwise the largest per-trace context-size attribute
 * the rollup saw. Dash when never reported.
 */
export const SessionContextSizeCell: CellDef<ConversationGroup> = {
  id: "contextSize",
  label: "Context Size",
  render: ({ row }) => {
    const tokens = row.contextSizeTokens ?? 0;
    if (tokens <= 0) return <MonoCell>{dash}</MonoCell>;
    return (
      <Tooltip
        content={CONTEXT_SIZE_EXPLANATION}
        positioning={{ placement: "top" }}
      >
        <MonoCell>{formatTokens(tokens)}</MonoCell>
      </Tooltip>
    );
  },
  renderComfortable: ({ row }) => {
    const tokens = row.contextSizeTokens ?? 0;
    return (
      <Text textStyle="xs" color="fg.muted" textAlign="right">
        {tokens > 0 ? formatTokens(tokens) : dash}
      </Text>
    );
  },
};

/**
 * Coding-agent enrichment counters. Null (dash) for ordinary conversations:
 * these only exist when the session's conversation id matches a pre-folded
 * coding-agent session row.
 */
function createCodingAgentCountCell({
  id,
  label,
  read,
}: {
  id: string;
  label: string;
  read: (row: ConversationGroup) => number | null | undefined;
}): CellDef<ConversationGroup> {
  return {
    id,
    label,
    render: ({ row }) => {
      const value = read(row);
      return <MonoCell>{value == null ? dash : value}</MonoCell>;
    },
    renderComfortable: ({ row }) => {
      const value = read(row);
      return (
        <Text textStyle="xs" color="fg.muted" textAlign="right">
          {value == null ? dash : value}
        </Text>
      );
    },
  };
}

export const ModelCallsCell = createCodingAgentCountCell({
  id: "modelCalls",
  label: "Model Calls",
  read: (row) => row.modelCalls,
});

export const CompactionsCell = createCodingAgentCountCell({
  id: "compactions",
  label: "Compactions",
  read: (row) => row.compactions,
});
