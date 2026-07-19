import { Text } from "@chakra-ui/react";
import type { ReactElement } from "react";
import { Tooltip } from "~/components/ui/tooltip";
import type { TraceListItem } from "../../../../../types/trace";
import { formatTokens } from "../../../../../utils/formatters";
import { TokenBreakdownTooltipContent } from "../../../../shared/TokenBreakdownTooltip";
import { MonoCell } from "../../../MonoCell";
import type { CellDef } from "../../types";

// The cell shows the input+output "delta"; the hover surfaces the full
// breakdown so a cached turn's true processed-token count (input + output +
// cache read + cache write) is one hover away — Anthropic reports input as the
// NON-cached portion, so the cache counts are additive, not a subset.
function totalWithCacheOf(row: TraceListItem): number {
  return (
    row.totalTokens + (row.cacheReadTokens ?? 0) + (row.cacheCreationTokens ?? 0)
  );
}

// Suppress the "estimated" caveat when we have concrete input AND output
// numbers — historical summaries can carry a stale tokensEstimated flag.
function isEstimated(row: TraceListItem): boolean {
  const hasAuthoritative =
    row.inputTokens != null &&
    row.outputTokens != null &&
    (row.inputTokens > 0 || row.outputTokens > 0);
  return Boolean(row.tokensEstimated) && !hasAuthoritative;
}

function TokenBreakdownTooltip({
  row,
  children,
}: {
  row: TraceListItem;
  children: ReactElement;
}) {
  return (
    <Tooltip
      content={
        <TokenBreakdownTooltipContent
          inputTokens={row.inputTokens ?? null}
          outputTokens={row.outputTokens ?? null}
          cacheReadTokens={row.cacheReadTokens ?? null}
          cacheCreationTokens={row.cacheCreationTokens ?? null}
          reasoningTokens={row.reasoningTokens ?? null}
          totalWithCache={totalWithCacheOf(row)}
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
