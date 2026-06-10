import { Box, Text, VStack } from "@chakra-ui/react";
import { TooltipRow } from "./TooltipRow";

interface TokenBreakdownTooltipContentProps {
  /** Input (prompt) tokens; null renders an em dash. */
  inputTokens: number | null;
  /** Output (completion) tokens; null renders an em dash. */
  outputTokens: number | null;
  /** Cache-read tokens; row hidden when null (model has no prompt caching). */
  cacheReadTokens: number | null;
  /** Cache-write tokens; row hidden when null. */
  cacheCreationTokens: number | null;
  /** Reasoning tokens; row hidden when null (e.g. Anthropic never reports them). */
  reasoningTokens: number | null;
  /**
   * Total the model actually processed = input + output + cache read + cache
   * write. Computed by the caller so the cell and the drawer header stay in
   * lockstep. Reasoning is a subset of output, so it is not added again.
   */
  totalWithCache: number;
  /** Surfaces the "Tokens are estimated" caveat under the total. */
  estimated?: boolean;
}

/**
 * The token breakdown shown in the trace-details Tokens pill tooltip, shared so
 * the trace list's Tokens cell surfaces the same input / output / cache read /
 * cache write / reasoning split on hover instead of just the input+output
 * delta. Cache + reasoning rows render only when the trace actually reported
 * them — a model with no prompt caching (or no reasoning) shouldn't carry empty
 * rows.
 */
export function TokenBreakdownTooltipContent({
  inputTokens,
  outputTokens,
  cacheReadTokens,
  cacheCreationTokens,
  reasoningTokens,
  totalWithCache,
  estimated,
}: TokenBreakdownTooltipContentProps) {
  return (
    <VStack align="stretch" gap={0.5} minWidth="180px">
      <TooltipRow label="Input" value={inputTokens?.toLocaleString() ?? "—"} />
      <TooltipRow label="Output" value={outputTokens?.toLocaleString() ?? "—"} />
      {cacheReadTokens != null && (
        <TooltipRow
          label="Cache read"
          value={cacheReadTokens.toLocaleString()}
        />
      )}
      {cacheCreationTokens != null && (
        <TooltipRow
          label="Cache write"
          value={cacheCreationTokens.toLocaleString()}
        />
      )}
      {reasoningTokens != null && (
        <TooltipRow
          label="Reasoning"
          value={reasoningTokens.toLocaleString()}
        />
      )}
      <Box height="1px" bg="border" marginY={1} />
      <TooltipRow label="Total" value={totalWithCache.toLocaleString()} />
      {estimated && (
        <Text textStyle="2xs" color="fg.muted" paddingTop={1}>
          Tokens are estimated
        </Text>
      )}
    </VStack>
  );
}
