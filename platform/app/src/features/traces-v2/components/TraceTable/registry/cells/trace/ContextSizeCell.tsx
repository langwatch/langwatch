import { Text } from "@chakra-ui/react";
import { Tooltip } from "@langwatch/design-system/tooltip";
import type { TraceListItem } from "../../../../../types/trace";
import { formatTokens } from "@langwatch/trace-web";
import { MonoCell } from "../../../MonoCell";
import type { CellDef } from "../../types";

/**
 * How full the context window already was when the trace's first model call
 * ran. It answers a different question from Tokens: an agent turn re-sends its
 * whole conversation on every call, so the Tokens column's cache reads sum
 * into the millions, while a reader asking "how big was my context" means this
 * single number.
 */
const EXPLANATION = "Context carried into this trace's first model call.";

function ContextSizeText({ row }: { row: TraceListItem }) {
  const tokens = row.contextSizeTokens ?? 0;
  if (tokens <= 0) return <MonoCell>{"—"}</MonoCell>;
  return (
    <Tooltip content={EXPLANATION} positioning={{ placement: "top" }}>
      <MonoCell>{formatTokens(tokens)}</MonoCell>
    </Tooltip>
  );
}

export const ContextSizeCell = {
  id: "contextSize",
  label: "Context Size",
  render: ({ row }) => <ContextSizeText row={row} />,
  renderComfortable: ({ row }) => {
    const tokens = row.contextSizeTokens ?? 0;
    if (tokens <= 0) {
      return (
        <Text textStyle="sm" color="fg.muted" textAlign="right">
          {"—"}
        </Text>
      );
    }
    return (
      <Tooltip content={EXPLANATION} positioning={{ placement: "top" }}>
        <Text textStyle="sm" color="fg.muted" textAlign="right">
          {formatTokens(tokens)}
        </Text>
      </Tooltip>
    );
  },
} as const satisfies CellDef<TraceListItem>;
