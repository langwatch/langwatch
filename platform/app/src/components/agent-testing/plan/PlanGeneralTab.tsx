/**
 * The General tab of the run plan editor: what the plan is called, what it is
 * for, and what runs when it runs.
 *
 * A test suite runs the cases filed under it, so its scope is one fixed line
 * rather than a picker. A run plan is hand assembled, so its scope is the list
 * of test cases it holds.
 *
 * @see specs/features/agent-testing/run-plan-editor.feature
 */

import { Box, HStack, Input, Text, Textarea, VStack } from "@chakra-ui/react";
import { Folder } from "lucide-react";
import { ScenarioPicker } from "~/components/suites/ScenarioPicker";
import {
  DIALOG_FIELD_STYLE,
  FieldError,
  FieldLabel,
} from "../shared/DialogFields";
import { FG_FAINT } from "../shared/design";
import type { PlanEditorState } from "./usePlanEditor";

/** The list of test cases a hand-assembled run plan holds. */
function ScenarioScopeField({
  editor,
  onNewTestCase,
}: {
  editor: PlanEditorState;
  onNewTestCase: () => void;
}) {
  const { suiteForm } = editor;
  const errors = suiteForm.form.formState.errors;
  const count = suiteForm.selectedScenarioIds.length;

  return (
    <>
      <ScenarioPicker
        scenarios={suiteForm.filteredScenarios}
        selectedIds={suiteForm.selectedScenarioIds}
        totalCount={suiteForm.totalScenarioCount}
        onToggle={suiteForm.toggleScenario}
        onSelectAll={suiteForm.selectAllScenarios}
        onClear={suiteForm.clearScenarios}
        searchQuery={suiteForm.scenarioSearch}
        onSearchChange={suiteForm.setScenarioSearch}
        allLabels={suiteForm.allLabels}
        activeLabelFilter={suiteForm.activeLabelFilter}
        onLabelFilterChange={suiteForm.setActiveLabelFilter}
        onCreateNew={onNewTestCase}
        hasError={!!errors.selectedScenarioIds}
        archivedIds={editor.archivedScenariosWithNames}
        onRemoveArchived={suiteForm.removeArchivedScenario}
        folders={editor.folders}
      />
      <Text marginTop={1} fontSize="11px" color={FG_FAINT}>
        {count === 1
          ? "1 test case will run."
          : `${count} test cases will run.`}
      </Text>
      <FieldError message={errors.selectedScenarioIds?.message} />
    </>
  );
}

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

export function PlanGeneralTab({
  editor,
  onNewTestCase,
}: {
  editor: PlanEditorState;
  onNewTestCase: () => void;
}) {
  const { suiteForm } = editor;

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
          <ScenarioScopeField editor={editor} onNewTestCase={onNewTestCase} />
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
      <Text color="fg.muted">Test cases from the {suiteName} test suite</Text>
      <Box flex={1} />
      <Text fontSize="11.5px" color={FG_FAINT} whiteSpace="nowrap">
        {caseCount === 1 ? "1 case" : `${caseCount} cases`}
      </Text>
    </HStack>
  );
}
