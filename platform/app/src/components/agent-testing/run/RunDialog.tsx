/**
 * The run dialog: one question, the agent to be tested, and chips that add a
 * note, parameter overrides, or a prompt in place of the agent.
 *
 * The target used last time is preselected, so a repeat run is one click. For
 * a test suite the confirmed target is written onto the suite row, so the next
 * run of that suite preselects it on any browser.
 *
 * A refusal the server can name (no target, everything archived, an unknown
 * parameter) reads inside the dialog and the dialog stays open. Only failures
 * with nothing structured to say fall back to a toast.
 *
 * @see specs/features/agent-testing/run-dialog.feature
 * @see specs/suites/run-notes.feature
 * @see specs/suites/folder-run-plan-reuse.feature
 */

import { useState } from "react";
import { Dialog } from "~/components/ui/dialog";
import { RunDialogFields } from "./RunDialogFields";
import { RunDialogFooter } from "./RunDialogFooter";
import { isNoteTooLong } from "./RunNoteField";
import type { RunDialogProps, RunDialogSubject } from "./run-dialog-types";
import { type RunDialogForm, useRunDialogForm } from "./useRunDialogForm";
import {
  type RunDialogController,
  useRunDialogSubmit,
} from "./useRunDialogSubmit";

export { PARAMETER_LINE_PLACEHOLDER } from "./RunParametersSection";
export type {
  RunDialogProps,
  RunDialogSubject,
  RunStartedInfo,
} from "./run-dialog-types";

/** What the dialog is called, given what it was opened on. */
function dialogTitle(subject: RunDialogSubject): string {
  if (subject.kind === "plan") return "New run plan";
  if (subject.kind === "all") return "Run · All scenarios";
  return `Run · ${subject.name}`;
}

/**
 * Run waits for a target only when the project has nothing to test, since
 * there is nothing to choose. Every other missing target is a refusal the
 * server names, so the dialog reads the same reason whatever started the run.
 */
function isRunBlocked({
  form,
  controller,
}: {
  form: RunDialogForm;
  controller: RunDialogController;
}): boolean {
  if (controller.isBusy) return true;
  if (isNoteTooLong(form.note) || form.hasMissingSecrets) return true;
  if (form.runName.trim() === "") return true;
  if (form.caseCount === 0) return true;
  if (form.target) return false;
  return !controller.hasAnyTarget;
}

/**
 * Why the run cannot start, in one sentence. Empty when the run can start, or
 * when the block is one the field-level errors already speak to.
 */
function runBlockedReason({
  subject,
  form,
  controller,
}: {
  subject: RunDialogSubject | null;
  form: RunDialogForm;
  controller: RunDialogController;
}): string | null {
  if (controller.isBusy) return null;
  // The name is what a run plan is, so a run cannot go out without one.
  if (form.runName.trim() === "") return "Give the run a name.";
  if (form.caseCount === 0) {
    if (subject?.kind === "suite") {
      return "This test suite holds no scenario to run.";
    }
    return "The scope holds no scenario to run.";
  }
  if (!form.target && !controller.hasAnyTarget) {
    return "Choose an agent to run against.";
  }
  return null;
}

export function RunDialog({ subject, onClose, onRunStarted }: RunDialogProps) {
  // Escape belongs to the run name list while that list is open. The dialog's
  // own Escape handling listens on the document in the capture phase, so it
  // runs before the field can stop the key and has to be turned off instead.
  const [isNameListOpen, setIsNameListOpen] = useState(false);
  const form = useRunDialogForm(subject);
  const controller = useRunDialogSubmit({
    subject,
    target: form.target,
    runName: form.runName,
    runTargets: form.runTargets,
    scope: form.runScope,
    scopedScenarioIds: form.scopedScenarioIds,
    repeatCount: form.repeatCount,
    simulatorModel: form.simulatorModel,
    judgeModel: form.judgeModel,
    note: form.note,
    runParameters: form.runParameters,
    storableRunParameters: form.storableRunParameters,
    storableSecretNames: form.storableSecretNames,
    onRunStarted,
    onClose,
    setInlineError: form.setInlineError,
    setMissingProvider: form.setMissingProvider,
  });

  if (!subject) return null;

  return (
    <Dialog.Root
      open={!!subject}
      onOpenChange={({ open }) => {
        if (!open && !controller.isBusy) onClose();
      }}
      placement="center"
      closeOnEscape={!isNameListOpen}
    >
      <Dialog.Content
        bg="bg.panel"
        maxWidth="600px"
        onClick={(event) => event.stopPropagation()}
        data-testid={subject.kind === "case" ? "run-case-dialog" : "run-dialog"}
      >
        <Dialog.Header
          borderBottomWidth="1px"
          borderColor="border"
          paddingX={5}
          paddingY={3.5}
          display="block"
        >
          <Dialog.Title fontSize="14px" fontWeight="semibold">
            {dialogTitle(subject)}
          </Dialog.Title>
          <Dialog.CloseTrigger />
        </Dialog.Header>
        <Dialog.Body
          paddingX={5}
          paddingY={4}
          maxHeight="58vh"
          overflowY="auto"
        >
          <RunDialogFields
            form={form}
            isBusy={controller.isBusy}
            onNameListOpenChange={setIsNameListOpen}
          />
        </Dialog.Body>
        <RunDialogFooter
          controller={controller}
          isRunBlocked={isRunBlocked({ form, controller })}
          blockedReason={runBlockedReason({ subject, form, controller })}
          caseCount={form.caseCount}
          onClose={onClose}
        />
      </Dialog.Content>
    </Dialog.Root>
  );
}
