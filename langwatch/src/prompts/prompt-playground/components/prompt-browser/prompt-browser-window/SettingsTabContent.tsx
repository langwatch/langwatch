import { VStack } from "@chakra-ui/react";
import {
  InputsFieldGroup,
  OutputsFieldGroup,
} from "~/prompts/forms/fields/PromptConfigVersionFieldGroup";
import { DemonstrationsField } from "~/prompts/forms/fields/DemonstrationsField";

/**
 * SettingsTabContent
 * Single Responsibility: Renders the Settings tab content with input, output, and demonstration fields.
 */
export function SettingsTabContent() {
  return (
    <VStack width="full" gap={6} p={3} align="start">
      <InputsFieldGroup />
      <OutputsFieldGroup />
      <DemonstrationsField />
    </VStack>
  );
}
