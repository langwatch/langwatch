import { Box, Text, VStack } from "@chakra-ui/react";
import { useCallback } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { type Variable, VariablesSection } from "~/components/variables";
import { transposeColumnsFirstToRowsFirstWithId } from "~/optimization_studio/utils/datasetUtils";
import { DemonstrationsField } from "~/prompts/forms/fields/DemonstrationsField";
import { RuntimeParametersField } from "~/prompts/forms/fields/RuntimeParametersField";
import type { PromptConfigFormValues } from "~/prompts/types";
import type { LlmConfigInputType } from "~/types";
import { LOCKED_VARIABLES, VARIABLE_INFO } from "./promptVariables";

/**
 * PromptAuthoringSections
 *
 * Single Responsibility: Render everything the prompt DECLARES, below the
 * messages that reference it.
 *
 * A variable exists because a message writes `{{name}}`, and parameters and
 * demonstrations are saved onto the prompt version the same way the messages
 * are — so all three are part of authoring the prompt and belong beside it.
 * They used to sit behind sub-tabs on the conversation, which put whole-prompt
 * authoring inside the pane you use to try one run.
 *
 * Declarations only: no value fields here. What a variable is worth on a
 * particular run is set at the message box, where the run is started, and a
 * value that could be typed in two places is a value nobody can be sure of.
 */
export function PromptAuthoringSections() {
  const form = useFormContext<PromptConfigFormValues>();
  const inputs =
    useWatch({ control: form.control, name: "version.configData.inputs" }) ??
    [];
  const demonstrations = useWatch({
    control: form.control,
    name: "version.configData.demonstrations",
  });

  const variables: Variable[] = inputs.map((input) => ({
    identifier: input.identifier,
    type: input.type,
  }));

  const handleVariablesChange = useCallback(
    (newVariables: Variable[]) => {
      form.setValue(
        "version.configData.inputs",
        newVariables.map((variable) => ({
          identifier: variable.identifier,
          type: variable.type as LlmConfigInputType,
        })),
      );
    },
    [form],
  );

  const hasDemonstrations =
    transposeColumnsFirstToRowsFirstWithId(
      demonstrations?.inline?.records ?? {},
    ).length > 0;

  return (
    <VStack align="stretch" gap={6} width="full" paddingTop={4}>
      <AuthoringSection description="Variables are substituted into the prompt template when it runs.">
        <VariablesSection
          variables={variables}
          onChange={handleVariablesChange}
          showMappings={false}
          // No value column. The value belongs to a run, not to the prompt.
          isMappingDisabled
          canAddRemove
          readOnly={false}
          title="Variables"
          lockedVariables={LOCKED_VARIABLES}
          variableInfo={VARIABLE_INFO}
        />
      </AuthoringSection>

      <AuthoringSection description="Parameters are arbitrary configurations returned with the prompt, for use outside the prompt itself.">
        <RuntimeParametersField />
      </AuthoringSection>

      {hasDemonstrations && (
        <AuthoringSection>
          <DemonstrationsField />
        </AuthoringSection>
      )}
    </VStack>
  );
}

/**
 * One declaration block, opened by a rule so the sections read as separate
 * things rather than as more of the prompt above them.
 */
function AuthoringSection({
  description,
  children,
}: {
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Box
      borderTopWidth="1px"
      borderColor="border.muted"
      paddingTop={4}
      width="full"
    >
      <VStack align="stretch" gap={2} width="full">
        {children}
        {description && (
          <Text fontSize="xs" color="fg.subtle">
            {description}
          </Text>
        )}
      </VStack>
    </Box>
  );
}
