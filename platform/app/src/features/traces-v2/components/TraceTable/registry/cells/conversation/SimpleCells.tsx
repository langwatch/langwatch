import { chakra, HStack, Text } from "@chakra-ui/react";
import type React from "react";
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
  "Largest context carried into a model call across the conversation.";

/**
 * Peak context size for the session: the coding-agent fold's peak when the
 * session has one, otherwise the largest per-trace context-size attribute
 * the rollup saw. Dash when never reported.
 */
export const SessionContextSizeCell: CellDef<ConversationGroup> = {
  id: "contextSize",
  label: "Context Size",
  render: ({ row }) => {
    const tokens = row.contextSizeTokens;
    // Only an absent value is a dash. A session that reported a peak of zero
    // told us something, and `formatTokens(0)` would hide it behind the same
    // mark as "never reported".
    if (tokens == null) return <MonoCell>{dash}</MonoCell>;
    return (
      <Tooltip
        content={CONTEXT_SIZE_EXPLANATION}
        positioning={{ placement: "top" }}
      >
        <MonoCell>{tokens === 0 ? "0" : formatTokens(tokens)}</MonoCell>
      </Tooltip>
    );
  },
  renderComfortable: ({ row }) => {
    const tokens = row.contextSizeTokens;
    return (
      <Text textStyle="xs" color="fg.muted" textAlign="right">
        {tokens == null ? dash : tokens === 0 ? "0" : formatTokens(tokens)}
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

/** `owner/name`, or null when the session reported no repository. */
function repositoryLabelOf(row: ConversationGroup): string | null {
  if (!row.repositoryOwner || !row.repositoryName) return null;
  return `${row.repositoryOwner}/${row.repositoryName}`;
}

/**
 * Where the session ran. Monospace, like every other identifier on the row,
 * so an owner/name reads as one token rather than prose.
 */
export const RepositoryCell: CellDef<ConversationGroup> = {
  id: "repository",
  label: "Repository",
  render: ({ row }) => {
    const label = repositoryLabelOf(row);
    return (
      <MonoCell truncate whiteSpace={undefined}>
        {label ?? dash}
      </MonoCell>
    );
  },
  renderComfortable: ({ row }) => {
    const label = repositoryLabelOf(row);
    return (
      <Text textStyle="xs" color="fg.muted" truncate>
        {label ?? dash}
      </Text>
    );
  },
};

/**
 * The pull request this session's work belongs to. The number links straight
 * to GitHub and the title rides in the tooltip, so the column stays narrow
 * while the row still says which pull request it is.
 */
const PullRequestLink: React.FC<{
  pullRequest: NonNullable<ConversationGroup["pullRequest"]>;
}> = ({ pullRequest }) => (
  <Tooltip content={pullRequest.title} positioning={{ placement: "top" }}>
    <chakra.a
      href={pullRequest.htmlUrl}
      target="_blank"
      rel="noreferrer noopener"
      onClick={(e: React.MouseEvent) => e.stopPropagation()}
      color="blue.fg"
      textStyle="xs"
      whiteSpace="nowrap"
      _hover={{ textDecoration: "underline" }}
    >
      #{pullRequest.number}
    </chakra.a>
  </Tooltip>
);

export const PullRequestCell: CellDef<ConversationGroup> = {
  id: "pullRequest",
  label: "Pull Request",
  render: ({ row }) =>
    row.pullRequest ? (
      <PullRequestLink pullRequest={row.pullRequest} />
    ) : (
      <MonoCell>{dash}</MonoCell>
    ),
  renderComfortable: ({ row }) =>
    row.pullRequest ? (
      <PullRequestLink pullRequest={row.pullRequest} />
    ) : (
      <Text textStyle="xs" color="fg.muted">
        {dash}
      </Text>
    ),
};
