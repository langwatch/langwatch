import { VStack } from "@chakra-ui/react";
import { DemonstrationsField } from "../../fields/demonstrations-field";

/**
 * DemonstrationsTabContent
 * Single Responsibility: Renders the Demonstrations tab content with few-shot examples.
 */
export function DemonstrationsTabContent() {
  return (
    <VStack width="full" gap={6} p={3} align="start">
      <DemonstrationsField />
    </VStack>
  );
}
