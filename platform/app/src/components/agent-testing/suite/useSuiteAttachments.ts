/**
 * The evaluators of a suite draft: the list to pick from, the editor of one
 * attachment, and the writes both of them make into the store.
 *
 * The pick and the edits run while the suite editor drawer is unmounted, so
 * every one of them reads and writes the store rather than a render's draft.
 *
 * @see specs/features/agent-testing/suite-editor.feature
 */

import { useCallback, useEffect, useMemo } from "react";
import { useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type {
  EvaluatorAttachment,
  ScenarioMappingContext,
} from "~/server/scenarios/evaluator-attachments";
import { api } from "~/utils/api";
import {
  type AttachableEvaluator,
  missingInputsOf,
} from "../evaluators/attachment-rules";
import { useOpenScenarioEvaluatorEditor } from "../evaluators/useOpenScenarioEvaluatorEditor";
import { useProjectEvaluators } from "../evaluators/useProjectEvaluators";
import { type SuiteDraft, useSuiteEditorStore } from "./suiteEditorStore";
import {
  openEvaluatorPicker,
  type SuiteDraftUpdate,
  useSuiteAttachmentEditing,
} from "./useSuiteAttachmentPicker";

/** Opens the evaluators section, with a pick already in flight. */
function openEvaluatorsSection({
  update,
  add,
}: {
  update: SuiteDraftUpdate;
  add: () => void;
}) {
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
  const pendingAttachmentId = useSuiteEditorStore(
    (state) => state.pendingAttachmentId,
  );
  const setPendingAttachmentId = useSuiteEditorStore(
    (state) => state.setPendingAttachmentId,
  );

  useEffect(() => {
    if (!isOpen || !draft || !pendingAttachmentId) return;
    const attachment = draft.evaluators.find(
      (candidate) => candidate.id === pendingAttachmentId,
    );
    if (!attachment) {
      setPendingAttachmentId(null);
      return;
    }
    if (!evaluatorsById.has(attachment.evaluatorId)) return;
    setPendingAttachmentId(null);
    edit(attachment);
  }, [
    isOpen,
    draft,
    pendingAttachmentId,
    evaluatorsById,
    edit,
    setPendingAttachmentId,
  ]);
}
