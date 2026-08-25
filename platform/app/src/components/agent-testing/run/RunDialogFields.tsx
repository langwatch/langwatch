/**
 * The body of the run dialog: the target, then whatever the chips added, then
 * the chips themselves and any refusal the server could name.
 *
 * @see specs/features/agent-testing/run-dialog.feature
 */

import { Box, VStack } from "@chakra-ui/react";
import { HandledErrorAlert } from "~/features/errors";
import { CustomizeRunChips } from "./CustomizeRunChips";
import { MissingProviderNotice } from "./MissingProviderNotice";
import { RunNoteField } from "./RunNoteField";
import { RunParametersSection } from "./RunParametersSection";
import { TargetSection } from "./TargetSection";
import type { RunDialogForm } from "./useRunDialogForm";

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

      <CustomizeRunChips chips={form.chips} />

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
