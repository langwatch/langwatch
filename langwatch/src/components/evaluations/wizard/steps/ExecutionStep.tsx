import { EmptyState, Text, VStack } from "@chakra-ui/react";
import { LuRabbit } from "react-icons/lu";

export function ExecutionStep() {
  return (
    <EmptyState.Root size="md" paddingBottom={0}>
      <EmptyState.Content>
        <EmptyState.Indicator>
          <LuRabbit />
        </EmptyState.Indicator>
        <EmptyState.Title>Automatic Execution</EmptyState.Title>
        <EmptyState.Description>
          <VStack gap={2} align="center">
            <Text textAlign="center">
              No need to select an executor for real-time evaluations.
            </Text>
          </VStack>
        </EmptyState.Description>
      </EmptyState.Content>
    </EmptyState.Root>
  );
}
