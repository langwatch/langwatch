/**
 * The body of the run dialog: the target, then whatever the chips added, then
 * the chips themselves and any refusal the server could name.
 *
 * @see specs/features/agent-testing/run-dialog.feature
 */

import { Box, VStack } from "@chakra-ui/react";
import { HandledErrorAlert } from "../../../../behavior/errors";
import { CustomizeChips } from "../../../elements/agent-testing/shared/customize-chips";
import { MissingProviderNotice } from "../../../elements/agent-testing/run/missing-provider-notice";
import { RunNoteField } from "../../../elements/agent-testing/run/run-note-field";
import { RunParametersSection } from "./run-parameters-section";
import { TargetSection } from "./target-section";
import type { RunDialogForm } from "./use-run-dialog-form";

export function RunDialogFields({
  form,
  isBusy,
}: {
  form: RunDialogForm;
  isBusy: boolean;
}) {
  return (
    <VStack align="stretch" gap={4}>
      <TargetSection
        mode={form.mode}
        agents={form.scenarioAgents}
        prompts={form.publishedPrompts}
        target={form.target}
        onSelect={form.setTarget}
        onRemovePromptPicker={form.removePromptPicker}
        onSetupAgent={form.handleSetupAgent}
      />

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

      {form.showParams && <RunParametersSection form={form} isBusy={isBusy} />}

      <CustomizeChips
        title="Customize your run"
        chips={form.chips}
        testId="customize-run-chips"
      />

      {form.missingProvider && <MissingProviderNotice />}

      {form.inlineError != null && (
        <Box data-testid="run-dialog-error">
          <HandledErrorAlert
            error={form.inlineError}
            fallbackTitle="Couldn't start the run"
          />
        </Box>
      )}
    </VStack>
  );
}
