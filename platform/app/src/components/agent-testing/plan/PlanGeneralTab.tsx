/**
 * The General tab of the run plan editor: what the plan is called, what it is
 * for, and what runs when it runs.
 *
 * A test suite runs the cases filed under it, so its scope is one fixed line
 * rather than a picker. A run plan says what it covers as a rule, which is
 * resolved again at every run.
 *
 * @see specs/features/agent-testing/run-plan-editor.feature
 */

import { Box, HStack, Input, Text, Textarea, VStack } from "@chakra-ui/react";
import { Folder } from "lucide-react";
import {
  DIALOG_FIELD_STYLE,
  FieldError,
  FieldLabel,
} from "../shared/DialogFields";
import { FG_MUTED } from "../shared/design";
import { PlanScopeField } from "./PlanScopeField";
import type { PlanEditorState } from "./usePlanEditor";

/** What the plan is called and what it is for. */
function NameAndDescriptionFields({
  form,
}: {
  form: PlanEditorState["suiteForm"]["form"];
}) {
  const errors = form.formState.errors;

  return (
    <>
      <Box>
        <FieldLabel>Name</FieldLabel>
        <Input
          {...DIALOG_FIELD_STYLE}
          autoFocus
          aria-label="Name"
          aria-invalid={!!errors.name || undefined}
          placeholder="Pre-release regression"
          {...form.register("name")}
          borderColor={errors.name ? "red.500" : "border"}
        />
        <FieldError message={errors.name?.message} />
      </Box>

      <Box>
        <FieldLabel>Description · optional</FieldLabel>
        <Textarea
          {...DIALOG_FIELD_STYLE}
          rows={2}
          resize="none"
          aria-label="Description"
          placeholder="Core journeys that must pass before deploy"
          {...form.register("description")}
        />
        <FieldError message={errors.description?.message} />
      </Box>
    </>
  );
}

export function PlanGeneralTab({ editor }: { editor: PlanEditorState }) {
  const { suiteForm } = editor;
  const scopeError = suiteForm.form.formState.errors.scope;

  return (
    <VStack align="stretch" gap={4}>
      <NameAndDescriptionFields form={suiteForm.form} />

      <Box>
        <FieldLabel>What runs</FieldLabel>
        {editor.isFixedScope ? (
          <FixedScopeRow
            suiteName={editor.suiteName}
            caseCount={suiteForm.selectedScenarioIds.length}
          />
        ) : (
          <>
            <PlanScopeField editor={editor} hasError={!!scopeError} />
            <FieldError message={scopeError?.message} />
          </>
        )}
      </Box>
    </VStack>
  );
}

/** What a test suite runs, which its own filing decides rather than this form. */
function FixedScopeRow({
  suiteName,
  caseCount,
}: {
  suiteName: string;
  caseCount: number;
}) {
  return (
    <HStack
      gap={2}
      borderWidth="1px"
      borderColor="border"
      borderRadius="lg"
      background="bg.muted/50"
      paddingX={3}
      paddingY={2.5}
      fontSize="12.5px"
      data-testid="plan-fixed-scope"
    >
      <Folder size={13} color="var(--chakra-colors-fg-muted)" />
      <Text color="fg.muted">Scenarios from the {suiteName} test suite</Text>
      <Box flex={1} />
      <Text fontSize="11.5px" color={FG_MUTED} whiteSpace="nowrap">
        {caseCount === 1 ? "1 scenario" : `${caseCount} scenarios`}
      </Text>
    </HStack>
  );
}
