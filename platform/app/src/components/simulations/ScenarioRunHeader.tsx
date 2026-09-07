import { Box, HStack, Text, VStack } from "@chakra-ui/react";

import type { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";
import { CopyButton } from "../CopyButton";
import { ScenarioRunStatusIcon } from "./ScenarioRunStatusIcon";

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
  /** True when LangWatch ended the call at the limit; shows a marker (AC28). */
  cutAtLimit?: boolean;
}

export function ScenarioRunHeader({
  status,
  name,
  copyableIds,
  caller,
  cutAtLimit,
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
              {cutAtLimit ? (
                <Text
                  fontSize="xs"
                  fontWeight="medium"
                  color="fg.muted"
                  borderWidth="1px"
                  borderColor="border"
                  borderRadius="md"
                  px={2}
                  py={0.5}
                >
                  Cut at the call limit
                </Text>
              ) : null}
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
                  <CopyButton
                    value={id.value}
                    label={id.label}
                    height="auto"
                    display="inline-block"
                  />
                </HStack>
              ))}
            </VStack>
          </VStack>
        </VStack>
      </HStack>
    </Box>
  );
}
