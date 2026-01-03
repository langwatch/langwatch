import { VStack } from "@chakra-ui/react";
import { DemonstrationsField } from "~/prompts/forms/fields/DemonstrationsField";

/**
 * SettingsTabContent
 * Single Responsibility: Renders the Settings tab content with demonstrations.
 * Outputs are now managed in the LLM Config popover.
 */
export function SettingsTabContent() {
  return (
    <VStack width="full" gap={6} p={3} align="start">
      <DemonstrationsField />
    </VStack>
  );
}
