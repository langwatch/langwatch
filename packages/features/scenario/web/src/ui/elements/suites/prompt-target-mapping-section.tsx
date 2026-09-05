/**
 * Scenario mappings for the prompt targets in a run plan.
 */

import { Box, Text, VStack } from "@chakra-ui/react";
import type { FieldMapping, Variable } from "@langwatch/prompt-web/surfaces/variables";
import type { SuiteTarget } from "@langwatch/suite-contract";
import { ScenarioInputMappingSection } from "./scenario-input-mapping-section";

/** A prompt as the run-plan form knows it. */
export interface MappablePrompt {
  id: string;
  handle?: string | null;
  inputs?: Variable[];
}

export interface PromptTargetMappingSectionProps {
  /** Every target currently selected in the run plan. */
  selectedTargets: SuiteTarget[];
  /** Prompts available to the project, carrying their declared inputs. */
  prompts: MappablePrompt[] | undefined;
  /** Called when a binding is set or cleared on one prompt target. */
  onMappingChange: (change: {
    target: SuiteTarget;
    identifier: string;
    mapping: FieldMapping | undefined;
  }) => void;
}

export function PromptTargetMappingSection({
  selectedTargets,
  prompts,
  onMappingChange,
}: PromptTargetMappingSectionProps) {
  const promptTargets = selectedTargets
    .filter((target) => target.type === "prompt")
    .map((target) => ({
      target,
      prompt: prompts?.find((candidate) => candidate.id === target.referenceId),
    }))
    .filter(
      (entry): entry is { target: SuiteTarget; prompt: MappablePrompt } =>
        (entry.prompt?.inputs?.length ?? 0) > 0,
    );

  if (promptTargets.length === 0) return null;

  return (
    <VStack align="stretch" gap={4} width="full">
      <Text fontSize="sm" color="fg.muted">
        Choose which part of a simulation each prompt reads. Anything left unset is matched by name
        when the run starts.
      </Text>
      {promptTargets.map(({ target, prompt }) => (
        <Box key={`${target.type}-${target.referenceId}`} width="full">
          <Text fontSize="sm" fontWeight="medium" marginBottom={2}>
            {prompt.handle ?? prompt.id}
          </Text>
          <ScenarioInputMappingSection
            inputs={prompt.inputs ?? []}
            mappings={(target.scenarioMappings ?? {}) as Record<string, FieldMapping>}
            onMappingChange={(identifier, mapping) =>
              onMappingChange({ target, identifier, mapping })
            }
          />
        </Box>
      ))}
    </VStack>
  );
}
