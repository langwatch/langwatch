/**
 * The Execution tab of the run plan editor: how many times each pair runs.
 *
 * What the plan runs against is not asked here. The run dialog chooses the
 * agent or the prompt for each run and remembers the choice on the plan, so
 * asking twice would give two answers to one question.
 *
 * @see specs/features/agent-testing/run-plan-editor.feature
 */

import { Box, HStack, Input, Text, VStack } from "@chakra-ui/react";
import { MAX_REPEAT_COUNT } from "~/server/suites/constants";
import {
  DIALOG_FIELD_STYLE,
  FieldError,
  FieldLabel,
} from "../shared/DialogFields";
import { FG_MUTED } from "../shared/design";
import type { PlanEditorState } from "./usePlanEditor";

/** How many times each scenario and target pair runs. */
function RepeatCountField({
  form,
}: {
  form: PlanEditorState["suiteForm"]["form"];
}) {
  const errors = form.formState.errors;

  return (
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
          {...DIALOG_FIELD_STYLE}
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
  );
}

export function PlanExecutionTab({ editor }: { editor: PlanEditorState }) {
  return (
    <VStack align="stretch" gap={4}>
      <RepeatCountField form={editor.suiteForm.form} />
      <Box>
        <FieldLabel>Agents and prompts</FieldLabel>
        <Text fontSize="11.5px" color={FG_MUTED}>
          Chosen when the run starts. The last choice is offered again next
          time.
        </Text>
      </Box>
    </VStack>
  );
}
