import { Box, HStack, Text, VStack } from "@chakra-ui/react";

import type { SimulationRunStatus as ScenarioRunStatus } from "@langwatch/scenario-contract";
import { CopyIdChip } from "./copy-id-chip.tsx";
import { ScenarioRunStatusIcon } from "./scenario-run-status-icon.tsx";

interface CopyableId {
  label: string;
  value: string;
}

interface ScenarioRunHeaderProps {
  status?: ScenarioRunStatus;
  name?: string | null;
  copyableIds: CopyableId[];
  /** "Simulated" or "You" for a voice run; absent hides the caller line (AC24). */
  caller?: "Simulated" | "You" | null;
}

export function ScenarioRunHeader({
  status,
  name,
  copyableIds,
  caller,
}: ScenarioRunHeaderProps) {
  return (
    <Box p={5} borderBottom="1px" borderColor="border" w="100%">
      <HStack justify="space-between" align="center">
        <VStack gap={4}>
          <VStack align="start" gap={0}>
            <HStack mb={2}>
              <ScenarioRunStatusIcon status={status} />
              <Text fontSize="lg" fontWeight="semibold">
                {name}
              </Text>
            </HStack>
            {caller ? (
              <Text fontSize="xs" color="fg.muted" mb={1}>
                Caller: {caller}
              </Text>
            ) : null}
            <VStack align="start" gap={0} ml={0}>
              {copyableIds.map((id) => (
                <HStack key={id.label} gap={1}>
                  <Text fontSize="xs" color="fg.muted" lineHeight="0">
                    {id.label}: {id.value}
                  </Text>
                  <CopyIdChip label={id.label} value={id.value} />
                </HStack>
              ))}
            </VStack>
          </VStack>
        </VStack>
      </HStack>
    </Box>
  );
}
