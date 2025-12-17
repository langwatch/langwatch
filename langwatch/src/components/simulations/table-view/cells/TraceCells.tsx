import { Text, Box, HStack } from "@chakra-ui/react";
import type { CellContext } from "@tanstack/react-table";
import { ArrowRight } from "lucide-react";
import { Tooltip } from "~/components/ui/tooltip";
import type { TraceRow } from "../types";

/**
 * Truncate text with ellipsis
 */
function truncate(text: string, maxLength: number) {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + "...";
}

/**
 * Trace ID cell - shows truncated ID with full ID in tooltip
 */
export function TraceIdCell({ getValue }: CellContext<TraceRow, unknown>) {
  const traceId = String(getValue() ?? "");
  return (
    <Tooltip content={traceId}>
      <Text fontFamily="mono" fontSize="xs" cursor="pointer">
        {truncate(traceId, 12)}
      </Text>
    </Tooltip>
  );
}

/**
 * Timestamp cell - formats timestamp as locale string
 */
export function TraceTimestampCell({ getValue }: CellContext<TraceRow, unknown>) {
  const timestamp = getValue() as number;
  if (!timestamp) return <Text fontSize="sm">-</Text>;
  return (
    <Text fontSize="sm">
      {new Date(timestamp).toLocaleString()}
    </Text>
  );
}

/**
 * Input/Output cell - truncated with tooltip
 */
export function TraceTextCell({ getValue }: CellContext<TraceRow, unknown>) {
  const text = String(getValue() ?? "");
  if (!text) return <Text fontSize="sm" color="gray.400">-</Text>;

  return (
    <Tooltip content={<Box whiteSpace="pre-wrap" maxH="300px" overflow="auto">{text}</Box>}>
      <Text fontSize="sm" maxW="250px" truncate cursor="pointer">
        {text}
      </Text>
    </Tooltip>
  );
}

/**
 * Tokens cell - formats token count
 */
export function TraceTokensCell({ getValue }: CellContext<TraceRow, unknown>) {
  const tokens = getValue() as number;
  if (!tokens || tokens === 0) return <Text fontSize="sm" color="gray.400">-</Text>;
  return <Text fontSize="sm">{tokens.toLocaleString()}</Text>;
}

/**
 * Cost cell - formats cost as USD
 */
export function TraceCostCell({ getValue }: CellContext<TraceRow, unknown>) {
  const cost = getValue() as number;
  if (!cost || cost === 0) return <Text fontSize="sm" color="gray.400">-</Text>;
  return <Text fontSize="sm">${cost.toFixed(4)}</Text>;
}

/**
 * Arrow cell - indicates clickable row
 */
export function TraceArrowCell() {
  return (
    <HStack justify="center">
      <ArrowRight size={16} color="gray" />
    </HStack>
  );
}

/**
 * Metadata cell - shows JSON metadata with tooltip
 */
export function TraceMetadataCell({ getValue }: CellContext<TraceRow, unknown>) {
  const metadata = getValue() as Record<string, unknown>;
  if (!metadata || Object.keys(metadata).length === 0) {
    return <Text fontSize="sm" color="gray.400">-</Text>;
  }

  const formatted = JSON.stringify(metadata, null, 2);
  const preview = Object.keys(metadata).slice(0, 2).map(k => `${k}: ${String(metadata[k]).slice(0, 20)}`).join(", ");

  return (
    <Tooltip content={<Box whiteSpace="pre-wrap" maxH="300px" overflow="auto" fontFamily="mono" fontSize="xs">{formatted}</Box>}>
      <Text fontSize="sm" maxW="200px" truncate cursor="pointer">
        {preview}{Object.keys(metadata).length > 2 ? "..." : ""}
      </Text>
    </Tooltip>
  );
}
