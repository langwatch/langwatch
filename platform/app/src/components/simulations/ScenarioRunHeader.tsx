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
}

export function ScenarioRunHeader({
  status,
  name,
  copyableIds,
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
            <VStack align="start" gap={0} ml={0}>
              {copyableIds.map((id) => (
                <HStack key={id.label} gap={1} w="full">
                  {/* lineHeight 0 would collide wrapped lines now that long
                      ids break, so the text uses the normal leading. */}
                  <Text
                    fontSize="xs"
                    color="fg.muted"
                    wordBreak="break-word"
                    flex={1}
                    minWidth={0}
                  >
                    {id.label}: {id.value}
                  </Text>
                  <CopyButton
                    value={id.value}
                    label={id.label}
                    height="auto"
                    display="inline-block"
                    flexShrink={0}
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
