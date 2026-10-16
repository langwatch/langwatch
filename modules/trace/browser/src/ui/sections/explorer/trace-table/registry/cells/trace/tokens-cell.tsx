import { formatTokens } from "@langwatch/design-system/display-formatters";
import { Text } from "@langwatch/design-system/primitives";
import { Tooltip } from "@langwatch/design-system/tooltip";
import type { ReactElement } from "react";

import type { TraceListItem } from "../../../../../../../behavior/explorer/types/trace.ts";
import { TokenBreakdownTooltipContent } from "../../../../../../blocks/explorer/shared/token-breakdown-tooltip.tsx";
import { MonoCell } from "../../../../../../elements/explorer/trace-table/mono-cell.tsx";
import type { CellDef } from "../../types.ts";

// `totalTokens` counts every token processed (input, output, cache read and cache write);
// the hover breaks it down.
// Suppress the "estimated" caveat when we have concrete input AND output
// numbers — historical summaries can carry a stale tokensEstimated flag.
function isEstimated(row: TraceListItem): boolean {
  const hasAuthoritative =
    row.inputTokens != null &&
    row.outputTokens != null &&
    (row.inputTokens > 0 || row.outputTokens > 0);
  return Boolean(row.tokensEstimated) && !hasAuthoritative;
}

function TokenBreakdownTooltip({ row, children }: { row: TraceListItem; children: ReactElement }) {
  return (
    <Tooltip
      content={
        <TokenBreakdownTooltipContent
          inputTokens={row.inputTokens ?? null}
          outputTokens={row.outputTokens ?? null}
          cacheReadTokens={row.cacheReadTokens ?? null}
          cacheCreationTokens={row.cacheCreationTokens ?? null}
          reasoningTokens={row.reasoningTokens ?? null}
          totalWithCache={row.totalTokens}
          estimated={isEstimated(row)}
        />
      }
      positioning={{ placement: "top" }}
    >
      {children}
    </Tooltip>
  );
}

export const TokensCell = {
  id: "tokens",
  label: "Tokens",
  render: ({ row }) =>
    row.totalTokens > 0 ? (
      <TokenBreakdownTooltip row={row}>
        <MonoCell>{formatTokens(row.totalTokens)}</MonoCell>
      </TokenBreakdownTooltip>
    ) : (
      <MonoCell>{formatTokens(row.totalTokens)}</MonoCell>
    ),
  renderComfortable: ({ row }) =>
    row.totalTokens > 0 ? (
      <TokenBreakdownTooltip row={row}>
        <Text textStyle="sm" color="fg.muted" textAlign="right">
          {formatTokens(row.totalTokens)}
        </Text>
      </TokenBreakdownTooltip>
    ) : (
      <Text textStyle="sm" color="fg.muted" textAlign="right">
        {formatTokens(row.totalTokens)}
      </Text>
    ),
} as const satisfies CellDef<TraceListItem>;
