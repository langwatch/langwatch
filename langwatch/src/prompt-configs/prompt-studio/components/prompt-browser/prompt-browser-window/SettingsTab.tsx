import { VStack } from "@chakra-ui/react";
import {
  InputsFieldGroup,
  OutputsFieldGroup,
} from "~/prompt-configs/forms/fields/PromptConfigVersionFieldGroup";
import { DemonstrationsField } from "~/prompt-configs/forms/fields/DemonstrationsField";

export function SettingsTab() {
  return (
    <VStack width="full" gap={6} p={3} align="start">
      <InputsFieldGroup />
      <OutputsFieldGroup />
      <DemonstrationsField />
    </VStack>
  );
}
