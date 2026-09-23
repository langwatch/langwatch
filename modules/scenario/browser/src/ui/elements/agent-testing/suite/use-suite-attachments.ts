/**
 * The evaluators of a suite draft: the picker, the attachment editor and their writes. Both run
 * while the drawer is unmounted, so they read and write the store, not a render's draft.
 * @see specs/features/agent-testing/suite-editor.feature
 */

import { useDrawer } from "@langwatch/browser-host/drawer";
import type { EvaluatorAttachment, ScenarioMappingContext } from "@langwatch/scenario-contract";
import { useCallback, useEffect, useMemo } from "react";

import { useOpenScenarioEvaluatorEditor } from "../../../../behavior/agent-testing/evaluators/use-open-scenario-evaluator-editor.ts";
import { useProjectEvaluators } from "../../../../behavior/agent-testing/evaluators/use-project-evaluators.ts";
import { api } from "../../../../behavior/scenario-api.ts";
import { useOrganizationTeamProject } from "../../../../behavior/use-organization-team-project.ts";
import {
  type AttachableEvaluator,
  missingInputsOf,
} from "../../../../model/agent-testing/evaluators/attachment-rules.ts";
import { type SuiteDraft, useSuiteEditorStore } from "./suite-editor-store.ts";
import {
  openEvaluatorPicker,
  type SuiteDraftUpdate,
  useSuiteAttachmentEditing,
} from "./use-suite-attachment-picker.ts";

/** Opens the evaluators section, with a pick already in flight. */
function openEvaluatorsSection({ update, add }: { update: SuiteDraftUpdate; add: () => void }) {
  update((draft) => ({ ...draft, showEvaluators: true }));
  add();
}

/** Closes the evaluators section, dropping its attachments. */
function closeEvaluatorsSection(update: SuiteDraftUpdate) {
  update((draft) => ({
    ...draft,
    showEvaluators: false,
    evaluators: [],
    evaluatorsError: undefined,
  }));
}

export function useSuiteAttachments({
  ctx,
  testSuiteId,
}: {
  ctx: ScenarioMappingContext;
  testSuiteId: string | null;
}) {
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id ?? "";
  const utils = api.useUtils();
  const { openDrawer, goBack } = useDrawer();
  const update = useSuiteEditorStore((state) => state.update);
  const openEvaluatorEditor = useOpenScenarioEvaluatorEditor();
  const { evaluatorsById } = useProjectEvaluators();

  const missingOf = useCallback(
    (attachment: EvaluatorAttachment) =>
      missingInputsOf({
        attachment,
        evaluator: evaluatorsById.get(attachment.evaluatorId),
      }),
    [evaluatorsById],
  );

  const { edit, attach } = useSuiteAttachmentEditing({
    ctx,
    update,
    goBack,
    openEvaluatorEditor,
  });

  const add = useCallback(
    () =>
      openEvaluatorPicker({
        attach,
        openDrawer,
        goBack,
        utils,
        projectId,
        testSuiteId,
      }),
    [attach, openDrawer, goBack, utils, projectId, testSuiteId],
  );

  return useMemo(
    () => ({
      open: () => openEvaluatorsSection({ update, add }),
      close: () => closeEvaluatorsSection(update),
      add,
      edit: (attachment: EvaluatorAttachment) => {
        const evaluator = evaluatorsById.get(attachment.evaluatorId);
        if (evaluator) edit({ attachment, evaluator });
      },
      evaluatorsById,
      missingOf,
    }),
    [update, add, edit, evaluatorsById, missingOf],
  );
}

/**
 * Opens a pill's pending attachment as soon as the draft and its evaluator
 * are here, and only once: read the pending id, then clear it.
 */
export function usePendingAttachmentEditor({
  isOpen,
  draft,
  edit,
  evaluatorsById,
}: {
  isOpen: boolean;
  draft: SuiteDraft | null;
  edit: (attachment: EvaluatorAttachment) => void;
  evaluatorsById: ReadonlyMap<string, AttachableEvaluator>;
}) {
  const pendingAttachmentId = useSuiteEditorStore((state) => state.pendingAttachmentId);
  const setPendingAttachmentId = useSuiteEditorStore((state) => state.setPendingAttachmentId);

  useEffect(() => {
    if (!isOpen || !draft || !pendingAttachmentId) return;
    const attachment = draft.evaluators.find((candidate) => candidate.id === pendingAttachmentId);
    if (!attachment) {
      setPendingAttachmentId(null);
      return;
    }
    if (!evaluatorsById.has(attachment.evaluatorId)) return;
    setPendingAttachmentId(null);
    edit(attachment);
  }, [isOpen, draft, pendingAttachmentId, evaluatorsById, edit, setPendingAttachmentId]);
}
