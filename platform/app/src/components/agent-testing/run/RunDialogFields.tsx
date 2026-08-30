/**
 * The body of the run dialog: the name of the run, the agent it goes against,
 * what it covers when that is still being chosen, whatever the chips added,
 * and then the chips themselves.
 *
 * An entry point that already fixed the scope says nothing about it, so there
 * is no scope block and no line counting what it holds.
 *
 * @see specs/features/agent-testing/run-dialog.feature
 */

import { Box, VStack } from "@chakra-ui/react";
import { HandledErrorAlert } from "~/features/errors";
import { CustomizeChips } from "../shared/CustomizeChips";
import { FieldLabel } from "../shared/DialogFields";
import { CompareAgentsSection } from "./CompareAgentsSection";
import { MissingProviderNotice } from "./MissingProviderNotice";
import { ParameterRowsEditor } from "./ParameterRowsEditor";
import { RunNameField } from "./RunNameField";
import { RunNoteField } from "./RunNoteField";
import {
  RepeatCountSection,
  SimulationModelsSection,
} from "./RunOptionSections";
import { RunParametersSection } from "./RunParametersSection";
import { RunScopeSection } from "./RunScopeSection";
import { TargetSection } from "./TargetSection";
import type { RunDialogForm } from "./useRunDialogForm";

/** The blocks a chip added, in the order the chips offer them. */
function AddedBlocks({
  form,
  isBusy,
}: {
  form: RunDialogForm;
  isBusy: boolean;
}) {
  return (
    <>
      {form.showModels && (
        <SimulationModelsSection
          simulatorModel={form.simulatorModel}
          judgeModel={form.judgeModel}
          onSimulatorChange={form.setSimulatorModel}
          onJudgeChange={form.setJudgeModel}
          onRemove={() => {
            form.setShowModels(false);
            form.setSimulatorModel(null);
            form.setJudgeModel(null);
          }}
        />
      )}

      {form.showRepeat && (
        <RepeatCountSection
          repeatCount={form.repeatCount}
          onChange={form.setRepeatCount}
          onRemove={() => {
            form.setShowRepeat(false);
            form.setRepeatCount(1);
          }}
        />
      )}

      {form.showParams && !form.showCompare && (
        <RunParametersSection form={form} isBusy={isBusy} />
      )}

      {form.showNote && (
        <RunNoteField
          value={form.note}
          onChange={form.setNote}
          onRemove={() => {
            form.setShowNote(false);
            form.setNote("");
          }}
        />
      )}
    </>
  );
}

/**
 * The targets of a comparison, and under them the secrets the scope declares:
 * a secret is run-level, so one block serves every target.
 *
 * The block stands even while it holds nothing. A comparison replaces the
 * parameter section, so its "Add secret parameter" control is the only way
 * into an ad hoc secret, and hiding the block on an empty one would make a
 * person leave the comparison to type a secret.
 */
function ComparisonBlocks({
  form,
  isBusy,
}: {
  form: RunDialogForm;
  isBusy: boolean;
}) {
  return (
    <>
      <CompareAgentsSection
        rows={form.compareRows}
        agents={form.scenarioAgents}
        onChangeRow={form.updateCompareRow}
        onAddRow={form.addCompareRow}
        canAddRow={form.canAddCompareRow}
        onRemoveRow={form.removeCompareRow}
        onRemove={form.removeComparison}
        hasDuplicates={form.hasDuplicateCompareRows}
        defaults={form.parameterDefaults}
        definitions={form.parameterDefinitions}
        declaredParametersOf={form.declaredParametersOf}
        parameterError={form.parameterError}
        isBusy={isBusy}
      />
      <VStack align="stretch" gap={0} data-testid="run-dialog-compare-secrets">
        <FieldLabel>Secret parameters</FieldLabel>
        <ParameterRowsEditor
          rows={form.parameterRows}
          onChangeRow={form.updateParameterRow}
          onAddRow={form.addSecretParameterRow}
          onRemoveRow={form.removeParameterRow}
          declaredSecrets={form.secretDefinitions}
          secretValues={form.secretValues}
          onChangeSecretValue={form.setSecretValue}
          definitions={form.parameterDefinitions}
          disabled={isBusy}
          secretOnly
        />
      </VStack>
    </>
  );
}

/** What the dialog says when the run cannot start, or did not. */
function RunDialogNotices({ form }: { form: RunDialogForm }) {
  return (
    <>
      {form.missingProvider && <MissingProviderNotice />}

      {form.inlineError != null && (
        <Box data-testid="run-dialog-error">
          <HandledErrorAlert
            error={form.inlineError}
            fallbackTitle="Couldn't start the run"
          />
        </Box>
      )}
    </>
  );
}

export function RunDialogFields({
  form,
  isBusy,
  onNameListOpenChange,
}: {
  form: RunDialogForm;
  isBusy: boolean;
  /** The dialog holds its own Escape handling off while the list is open. */
  onNameListOpenChange: (isOpen: boolean) => void;
}) {
  return (
    <VStack align="stretch" gap={4}>
      <RunNameField
        value={form.runName}
        options={form.options}
        onChange={form.setRunName}
        onPick={form.applyConfiguration}
        onListOpenChange={onNameListOpenChange}
        isBusy={isBusy}
      />

      {form.showCompare ? (
        <ComparisonBlocks form={form} isBusy={isBusy} />
      ) : (
        <TargetSection
          mode={form.mode}
          agents={form.scenarioAgents}
          prompts={form.publishedPrompts}
          target={form.target}
          onSelect={form.setTarget}
          onRemovePromptPicker={form.removePromptPicker}
          onSetupAgent={form.handleSetupAgent}
        />
      )}

      {form.isScopePicked && (
        <RunScopeSection
          scope={form.scope}
          testSuites={form.testSuites}
          scenarios={form.scopeScenarios}
          onChange={form.setScope}
        />
      )}

      <AddedBlocks form={form} isBusy={isBusy} />

      <CustomizeChips
        title="Customize your run"
        chips={form.chips}
        testId="customize-run-chips"
      />

      <RunDialogNotices form={form} />
    </VStack>
  );
}
