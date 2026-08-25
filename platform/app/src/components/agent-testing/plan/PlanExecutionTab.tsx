/**
 * The Execution tab of the run plan editor: what the plan runs against, how
 * a prompt target reads its inputs, and how many times each pair runs.
 *
 * The prototype has no place for targets, and a run plan cannot run without
 * one, so they read here, beside the other thing that decides how much work a
 * run is.
 *
 * @see specs/features/agent-testing/run-plan-editor.feature
 */

import { Box, HStack, Input, Text, VStack } from "@chakra-ui/react";
import { PromptTargetMappingSection } from "~/components/suites/PromptTargetMappingSection";
import { TargetPicker } from "~/components/suites/TargetPicker";
import { MAX_REPEAT_COUNT } from "~/server/suites/constants";
import { FG_MUTED } from "../shared/design";
import { FieldError, FieldLabel, PLAN_FIELD_STYLE } from "./PlanFields";
import type { PlanEditorState } from "./usePlanEditor";

export function PlanExecutionTab({
  editor,
  onAddTarget,
}: {
  editor: PlanEditorState;
  onAddTarget: () => void;
}) {
  const { suiteForm } = editor;
  const { form } = suiteForm;
  const errors = form.formState.errors;

  return (
    <VStack align="stretch" gap={4}>
      <Box>
        <FieldLabel>Agents and prompts to be tested</FieldLabel>
        <TargetPicker
          targets={suiteForm.filteredTargets}
          selectedTargets={suiteForm.selectedTargets}
          totalCount={suiteForm.availableTargets.length}
          isTargetSelected={suiteForm.isTargetSelected}
          onToggle={suiteForm.toggleTarget}
          onSelectAll={suiteForm.selectAllTargets}
          onClear={suiteForm.clearTargets}
          searchQuery={suiteForm.targetSearch}
          onSearchChange={suiteForm.setTargetSearch}
          onAddTarget={onAddTarget}
          hasError={!!errors.selectedTargets}
          archivedTargets={editor.archivedTargetsWithNames}
          onRemoveArchived={suiteForm.removeArchivedTarget}
        />
        <FieldError message={errors.selectedTargets?.message} />
      </Box>

      <PromptTargetMappingSection
        selectedTargets={suiteForm.selectedTargets}
        prompts={editor.prompts}
        onMappingChange={suiteForm.setTargetMapping}
      />

      <Box>
        <HStack
          gap={2}
          borderWidth="1px"
          borderColor="border"
          borderRadius="lg"
          paddingX={3}
          paddingY={2.5}
          fontSize="12.5px"
        >
          <Text fontWeight="medium">Repeat count</Text>
          <Input
            {...PLAN_FIELD_STYLE}
            type="number"
            width="56px"
            paddingX={2}
            fontSize="12px"
            aria-label="Repeat count"
            min={1}
            max={MAX_REPEAT_COUNT}
            {...form.register("repeatCount", { valueAsNumber: true })}
            borderColor={errors.repeatCount ? "red.500" : "border"}
          />
          <Text color={FG_MUTED}>
            times per scenario x target (max {MAX_REPEAT_COUNT})
          </Text>
        </HStack>
        <FieldError message={errors.repeatCount?.message} />
      </Box>
    </VStack>
  );
}
