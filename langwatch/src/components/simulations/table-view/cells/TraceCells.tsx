import { Text, HStack } from "@chakra-ui/react";
import type { CellContext } from "@tanstack/react-table";
import { ArrowRight } from "lucide-react";
import type { ScenarioRunRow } from "../types";
import type { ScenarioTrace } from "~/app/api/scenario-events/[[...route]]/types";

/**
 * Truncate text with ellipsis
 */
function truncate(text: string, maxLength: number) {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + "...";
}

export function TracesListCell({ getValue }: CellContext<ScenarioRunRow, unknown>) {
  const traces = getValue() as ScenarioTrace[];
  if (!traces || traces.length === 0) {
    return <Text fontSize="sm" color="gray.400">-</Text>;
  }

  return (
    <HStack gap={2} flexWrap="wrap">
      {traces.slice(0, 3).map((trace) => (
        <HStack key={trace.trace_id} gap={1}>
          <ArrowRight size={12} color="gray" />
          <Text fontFamily="mono" fontSize="xs" cursor="pointer">
            {truncate(trace.trace_id, 8)}
          </Text>
        </HStack>
      ))}
      {traces.length > 3 && (
        <Text fontSize="xs" color="gray.500">
          +{traces.length - 3} more
        </Text>
      )}
    </HStack>
  );
}
