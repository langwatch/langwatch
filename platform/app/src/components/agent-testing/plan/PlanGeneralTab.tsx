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
import { FG_FAINT } from "../shared/design";
import { FieldError, FieldLabel, DIALOG_FIELD_STYLE } from "../shared/DialogFields";
import type { PlanEditorState } from "./usePlanEditor";

export function PlanGeneralTab({
  editor,
  onNewTestCase,
}: {
  editor: PlanEditorState;
  onNewTestCase: () => void;
}) {
  const { suiteForm } = editor;
  const { form } = suiteForm;
  const errors = form.formState.errors;

  return (
    <VStack align="stretch" gap={4}>
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

      <Box>
        <FieldLabel>What runs</FieldLabel>
        {editor.isFixedScope ? (
          <FixedScopeRow
            suiteName={editor.suiteName}
            caseCount={suiteForm.selectedScenarioIds.length}
          />
        ) : (
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
              {suiteForm.selectedScenarioIds.length === 1
                ? "1 test case will run."
                : `${suiteForm.selectedScenarioIds.length} test cases will run.`}
            </Text>
            <FieldError message={errors.selectedScenarioIds?.message} />
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
      <Text color="fg.muted">
        Test cases from the {suiteName} test suite
      </Text>
      <Box flex={1} />
      <Text fontSize="11.5px" color={FG_FAINT} whiteSpace="nowrap">
        {caseCount === 1 ? "1 case" : `${caseCount} cases`}
      </Text>
    </HStack>
  );
}
