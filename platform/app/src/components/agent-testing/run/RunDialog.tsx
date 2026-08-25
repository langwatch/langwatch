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

function subjectTitle(subject: RunDialogSubject): string {
  return subject.kind === "all" ? "All test cases" : subject.name;
}

/**
 * Run waits for a target when there is no server-side refusal to lean on: a
 * one-off run has none, and a project with nothing to test has nothing to
 * choose.
 */
function isRunBlocked({
  subject,
  form,
  controller,
}: {
  subject: RunDialogSubject | null;
  form: RunDialogForm;
  controller: RunDialogController;
}): boolean {
  if (controller.isBusy) return true;
  if (isNoteTooLong(form.note) || form.hasMissingSecrets) return true;
  if (form.target) return false;
  return subject?.kind === "case" || !controller.hasAnyTarget;
}

export function RunDialog({
  subject,
  onClose,
  onRunStarted,
  onCaseRunSettled,
}: RunDialogProps) {
  const form = useRunDialogForm(subject);
  const controller = useRunDialogSubmit({
    subject,
    target: form.target,
    note: form.note,
    runParameters: form.runParameters,
    storableRunParameters: form.storableRunParameters,
    onRunStarted,
    onCaseRunSettled,
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
            Run · {subjectTitle(subject)}
          </Dialog.Title>
          <Dialog.CloseTrigger />
        </Dialog.Header>
        <Dialog.Body
          paddingX={5}
          paddingY={4}
          maxHeight="58vh"
          overflowY="auto"
        >
          <RunDialogFields form={form} isBusy={controller.isBusy} />
        </Dialog.Body>
        <RunDialogFooter
          controller={controller}
          hasTarget={!!form.target}
          isRunBlocked={isRunBlocked({ subject, form, controller })}
          caseCount={form.caseCount}
          onClose={onClose}
        />
      </Dialog.Content>
    </Dialog.Root>
  );
}
