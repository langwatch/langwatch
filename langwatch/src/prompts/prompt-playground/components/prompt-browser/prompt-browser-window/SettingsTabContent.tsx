import { VStack } from "@chakra-ui/react";
import { DemonstrationsField } from "~/prompts/forms/fields/DemonstrationsField";
import { OutputsFieldGroup } from "~/prompts/forms/fields/PromptConfigVersionFieldGroup";

/**
 * SettingsTabContent
 * Single Responsibility: Renders the Settings tab content with outputs and demonstrations.
 * Variables are managed in the Variables tab.
 */
export function SettingsTabContent() {
  return (
    <VStack width="full" gap={6} p={3} align="start">
      <OutputsFieldGroup />
      <DemonstrationsField />
    </VStack>
  );
}
