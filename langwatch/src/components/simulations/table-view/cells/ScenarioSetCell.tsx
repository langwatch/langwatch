import { HStack, Text } from "@chakra-ui/react";
import type { CellContext } from "@tanstack/react-table";
import { ExternalLink } from "lucide-react";
import type { ScenarioRunRow } from "../types";

/**
 * Scenario Set ID cell - shows ID with external link icon
 */
export function ScenarioSetCell({ getValue }: CellContext<ScenarioRunRow, unknown>) {
  const scenarioSetId = String(getValue() ?? "");

  return (
    <HStack gap={1}>
      <Text fontSize="sm" truncate maxW="150px">
        {scenarioSetId}
      </Text>
      <ExternalLink size={12} color="gray" />
    </HStack>
  );
}
