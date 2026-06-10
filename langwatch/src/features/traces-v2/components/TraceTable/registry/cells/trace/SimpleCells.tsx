import { Badge, Text } from "@chakra-ui/react";
import type { TraceListItem } from "../../../../../types/trace";
import { formatDuration, formatTokens } from "../../../../../utils/formatters";
import { MonoCell } from "../../../MonoCell";
import { StatusIndicator } from "../../../StatusRow";
import type { CellDef } from "../../types";
import { dash } from "../dashPlaceholder";

export const StatusCell = {
  id: "status",
  label: "Status",
  render: ({ row }) => <StatusIndicator status={row.status} />,
} as const satisfies CellDef<TraceListItem>;

export const TtftCell = {
  id: "ttft",
  label: "TTFT",
  render: ({ row }) => (
    <MonoCell>{row.ttft != null ? formatDuration(row.ttft) : dash}</MonoCell>
  ),
  renderComfortable: ({ row }) => (
    <Text textStyle="sm" color="fg.muted" textAlign="right">
      {row.ttft != null ? formatDuration(row.ttft) : dash}
    </Text>
  ),
} as const satisfies CellDef<TraceListItem>;

export const UserIdCell = {
  id: "userId",
  label: "User ID",
  render: ({ row }) => (
    <MonoCell color="fg.subtle" truncate>
      {row.userId || dash}
    </MonoCell>
  ),
  renderComfortable: ({ row }) => (
    <Text textStyle="sm" color="fg.muted" truncate>
      {row.userId || dash}
    </Text>
  ),
} as const satisfies CellDef<TraceListItem>;

export const ConversationIdCell = {
  id: "conversationId",
  label: "Conversation ID",
  render: ({ row }) => (
    <MonoCell color="fg.subtle" truncate>
      {row.conversationId || dash}
    </MonoCell>
  ),
  renderComfortable: ({ row }) => (
    <Text textStyle="sm" color="fg.muted" truncate>
      {row.conversationId || dash}
    </Text>
  ),
} as const satisfies CellDef<TraceListItem>;

const ORIGIN_LABEL: Record<string, string> = {
  application: "Application",
  simulation: "Simulation",
  evaluation: "Evaluation",
  workflow: "Workflow",
  playground: "Playground",
  gateway: "Gateway",
  sample: "Sample",
  coding_agent: "Coding Agent",
  ai_tool: "AI Tool",
};

/**
 * Map each origin to a Chakra `colorPalette` for the badge. Mirrors
 * the dot-color map (`ORIGIN_COLORS` in formatters) and the
 * canonical `~/utils/originColors.ts` table so the table chip,
 * filter sidebar dots, and any other origin renderer agree on
 * which colour each origin gets.
 */
const ORIGIN_PALETTE: Record<string, string> = {
  application: "blue",
  evaluation: "green",
  simulation: "pink",
  workflow: "cyan",
  playground: "teal",
  gateway: "purple",
  sample: "gray",
  coding_agent: "orange",
  ai_tool: "yellow",
};

export const OriginCell = {
  id: "origin",
  label: "Origin",
  render: ({ row }) => {
    const label = ORIGIN_LABEL[row.origin] ?? row.origin;
    const palette = ORIGIN_PALETTE[row.origin] ?? "gray";
    return (
      <Badge
        size="sm"
        variant="subtle"
        colorPalette={palette}
        textTransform="capitalize"
        fontWeight="medium"
      >
        {label}
      </Badge>
    );
  },
  // Compact density: smaller pill (xs badge, lighter weight, tighter
  // letterspacing) so the Origin column doesn't dominate the row at
  // high information densities. The Comfortable + default renderers
  // keep the prominent `sm` badge — operators reading expanded rows
  // benefit from the bigger colour chip.
  renderCompact: ({ row }) => {
    const label = ORIGIN_LABEL[row.origin] ?? row.origin;
    const palette = ORIGIN_PALETTE[row.origin] ?? "gray";
    return (
      <Badge
        size="xs"
        variant="subtle"
        colorPalette={palette}
        textTransform="capitalize"
        fontWeight="medium"
        paddingX={1.5}
      >
        {label}
      </Badge>
    );
  },
} as const satisfies CellDef<TraceListItem>;

export const TokensInCell = {
  id: "tokensIn",
  label: "Tokens In",
  render: ({ row }) => (
    <MonoCell>
      {row.inputTokens != null ? formatTokens(row.inputTokens) : dash}
    </MonoCell>
  ),
  renderComfortable: ({ row }) => (
    <Text textStyle="sm" color="fg.muted" textAlign="right">
      {row.inputTokens != null ? formatTokens(row.inputTokens) : dash}
    </Text>
  ),
} as const satisfies CellDef<TraceListItem>;

export const TokensOutCell = {
  id: "tokensOut",
  label: "Tokens Out",
  render: ({ row }) => (
    <MonoCell>
      {row.outputTokens != null ? formatTokens(row.outputTokens) : dash}
    </MonoCell>
  ),
  renderComfortable: ({ row }) => (
    <Text textStyle="sm" color="fg.muted" textAlign="right">
      {row.outputTokens != null ? formatTokens(row.outputTokens) : dash}
    </Text>
  ),
} as const satisfies CellDef<TraceListItem>;
