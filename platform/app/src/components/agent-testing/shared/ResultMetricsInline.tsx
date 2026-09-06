/**
 * What a run cost, beside a result: "6.3s · $0.0042".
 *
 * A run with neither number renders nothing, so a row never carries an empty
 * separator.
 */
import { Text } from "@chakra-ui/react";
import { formatCost, formatLatency } from "~/components/shared/formatters";

export type ResultMetricsInlineProps = {
  durationInMs?: number | null;
  totalCost?: number | null;
};

export function ResultMetricsInline({
  durationInMs,
  totalCost,
}: ResultMetricsInlineProps) {
  const parts: string[] = [];
  if (typeof durationInMs === "number") {
    parts.push(formatLatency(durationInMs));
  }
  if (typeof totalCost === "number") {
    parts.push(formatCost(totalCost));
  }

  if (parts.length === 0) return null;

  return (
    <Text fontSize="xs" color="fg.muted">
      {parts.join(" · ")}
    </Text>
  );
}
