import { Badge, Text } from "@chakra-ui/react";
import { useFilterStore } from "~/features/traces-v2/stores/filterStore";
import type { TraceListItem } from "../../../../../types/trace";
import { formatTokens } from "../../../../../utils/formatters";
import {
  originColorPalette,
  originLabel,
} from "../../../../../utils/originDisplay";
import { MonoCell } from "../../../MonoCell";
import { StatusIndicator } from "../../../StatusRow";
import type { CellDef } from "../../types";
import { dash } from "../dashPlaceholder";
import { FilterChip } from "../FilterChip";

/**
 * Origin badge that doubles as a facet filter — clicking it toggles the
 * `origin` facet (FilterChip stops propagation so the row's drawer doesn't
 * open). Mirrors the model / label cells. See
 * specs/traces-v2/origin-badge-filter.feature
 */
function renderOrigin(row: TraceListItem, size: "sm" | "xs") {
  const label = originLabel(row.origin);
  const palette = originColorPalette(row.origin);
  const badge = (
    <Badge
      size={size}
      variant="surface"
      colorPalette={palette}
      textTransform="capitalize"
      fontWeight="medium"
      {...(size === "xs" ? { paddingX: 1.5 } : {})}
    >
      {label}
    </Badge>
  );
  if (!row.origin) return badge;
  return (
    <FilterChip
      onFilter={() =>
        useFilterStore.getState().toggleFacet("origin", row.origin)
      }
      filterLabel={`Filter by origin "${label}"`}
    >
      {badge}
    </FilterChip>
  );
}

export const StatusCell = {
  id: "status",
  label: "Status",
  render: ({ row }) => <StatusIndicator status={row.status} />,
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

export const OriginCell = {
  id: "origin",
  label: "Origin",
  render: ({ row }) => renderOrigin(row, "sm"),
  // Compact density: smaller pill (xs badge, lighter weight, tighter
  // letterspacing) so the Origin column doesn't dominate the row at
  // high information densities. The Comfortable + default renderers
  // keep the prominent `sm` badge — operators reading expanded rows
  // benefit from the bigger colour chip.
  renderCompact: ({ row }) => renderOrigin(row, "xs"),
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
