import { formatTokens } from "@langwatch/design-system/display-formatters";
import { Badge, Text } from "@langwatch/design-system/primitives";
import { originColorPalette, originLabel } from "@langwatch/trace-contract";

import { useFilterStore } from "../../../../../../../behavior/explorer.store.ts";
import { FilterChip } from "../../../../../../blocks/explorer/trace-table/registry/cells/filter-chip.tsx";
import { MonoCell } from "../../../../../../elements/explorer/trace-table/mono-cell.tsx";
import { dash } from "../../../../../../elements/explorer/trace-table/registry/cells/dash-placeholder.tsx";
import { SpanTypeBadge } from "../../../../../../elements/explorer/trace-table/registry/cells/trace/span-type-badge.tsx";
import type { TraceListItem } from "../../../../types/trace.ts";
import { StatusIndicator } from "../../../status-row.tsx";
import type { CellDef } from "../../types.ts";

/**
 * Origin badge that doubles as a facet filter — clicking it toggles the `origin` facet
 * (FilterChip stops propagation so the row's drawer doesn't open). Mirrors the model /
 * label cells. See specs/traces-v2/origin-badge-filter.feature
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
      onFilter={() => useFilterStore.getState().toggleFacet("origin", row.origin)}
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
    <MonoCell>{row.inputTokens != null ? formatTokens(row.inputTokens) : dash}</MonoCell>
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
    <MonoCell>{row.outputTokens != null ? formatTokens(row.outputTokens) : dash}</MonoCell>
  ),
  renderComfortable: ({ row }) => (
    <Text textStyle="sm" color="fg.muted" textAlign="right">
      {row.outputTokens != null ? formatTokens(row.outputTokens) : dash}
    </Text>
  ),
} as const satisfies CellDef<TraceListItem>;

export const RootSpanNameCell = {
  id: "root-span-name",
  label: "Root span name",
  render: ({ row }) => (
    <Text textStyle="sm" color={row.name ? "fg" : "fg.subtle"} fontWeight="500" truncate>
      {row.name || dash}
    </Text>
  ),
} as const satisfies CellDef<TraceListItem>;

export const RootSpanTypeCell = {
  id: "root-span-type",
  label: "Root span type",
  render: ({ row }) => {
    const spanType = row.rootSpanType;
    if (!spanType) {
      return (
        <Text textStyle="sm" color="fg.subtle">
          —
        </Text>
      );
    }
    return <SpanTypeBadge spanType={spanType} display="inline-block" paddingY={0.5} />;
  },
} as const satisfies CellDef<TraceListItem>;

export const ServiceCell = {
  id: "service",
  label: "Service",
  render: ({ row }) => (
    <MonoCell color="fg.subtle" truncate whiteSpace={undefined}>
      {row.serviceName || dash}
    </MonoCell>
  ),
  renderComfortable: ({ row }) => (
    <Text textStyle="sm" color="fg.muted" truncate>
      {row.serviceName || dash}
    </Text>
  ),
} as const satisfies CellDef<TraceListItem>;

export const SpanCountCell = {
  id: "spans",
  label: "Spans",
  render: ({ row }) => <MonoCell>{row.spanCount.toLocaleString()}</MonoCell>,
  renderComfortable: ({ row }) => (
    <Text textStyle="sm" color="fg.muted" textAlign="right">
      {row.spanCount.toLocaleString()}
    </Text>
  ),
} as const satisfies CellDef<TraceListItem>;

export const TraceIdCell = {
  id: "trace-id",
  label: "Trace ID",
  render: ({ row }) => (
    <Text textStyle="xs" color="fg.subtle" truncate userSelect="all">
      {row.traceId}
    </Text>
  ),
} as const satisfies CellDef<TraceListItem>;

export const TraceNameCell = {
  id: "trace-name",
  label: "Trace name",
  render: ({ row }) => (
    <Text textStyle="sm" color={row.traceName ? "fg" : "fg.subtle"} fontWeight="500" truncate>
      {row.traceName || dash}
    </Text>
  ),
} as const satisfies CellDef<TraceListItem>;
