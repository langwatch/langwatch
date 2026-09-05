/**
 * Editing one of the plan's own attachments, and what a pick from the
 * evaluator list does with it: an evaluator a suite in scope already
 * carries is edited there instead of being attached twice, one the plan
 * already has opens its editor, and a new one is attached with the
 * conversation and the trace inferred.
 *
 * @see specs/features/agent-testing/run-dialog.feature
 */

import { useCallback } from "react";
import type { useDrawer } from "~/hooks/useDrawer";
import type { EvaluatorWithFields } from "~/server/evaluators/evaluator.service";
import type {
  EvaluatorAttachment,
  ScenarioMapping,
} from "~/server/scenarios/evaluator-attachments";
import type { api } from "~/utils/api";
import {
  type AttachableEvaluator,
  newAttachment,
  opensOnAttach,
} from "../evaluators/attachment-rules";
import type { useOpenScenarioEvaluatorEditor } from "../evaluators/useOpenScenarioEvaluatorEditor";
import type { InheritedSuite } from "./run-evaluators";
import { useAddExtraFlow } from "./useAddExtraFlow";

/** A plan level attachment reads no scenario field. */
const PLAN_CTX = { fields: [], toolNames: [] };

/** Writes into the plan's own extras, by change function. */
export type SetExtras = (
  change: (extras: EvaluatorAttachment[]) => EvaluatorAttachment[],
) => void;

/** The attachment of one id, and the attachments with it replaced. */
function replaceAttachment({
  attachments,
  attachmentId,
  change,
}: {
  attachments: readonly EvaluatorAttachment[];
  attachmentId: string;
  change: (attachment: EvaluatorAttachment) => EvaluatorAttachment;
}): EvaluatorAttachment[] {
  return attachments.map((attachment) =>
    attachment.id === attachmentId ? change(attachment) : attachment,
  );
}

/**
 * The mapping/required/remove callbacks an evaluator editor calls back into
 * for one of the plan's own attachments.
 */
function buildExtraEditorCallbacks({
  attachmentId,
  setExtras,
  goBack,
}: {
  attachmentId: string;
  setExtras: SetExtras;
  goBack: () => void;
}) {
  return {
    onMappingChange: (input: string, mapping: ScenarioMapping | undefined) =>
      setExtras((current) =>
        replaceAttachment({
          attachments: current,
          attachmentId,
          change: (entry) => {
            const mappings = { ...entry.mappings };
            if (mapping) mappings[input] = mapping;
            else delete mappings[input];
            return { ...entry, mappings };
          },
        }),
      ),
    onRequiredChange: (required: boolean) =>
      setExtras((current) =>
        replaceAttachment({
          attachments: current,
          attachmentId,
          change: (entry) => ({ ...entry, required }),
        }),
      ),
    onRemove: () => {
      setExtras((current) =>
        current.filter((entry) => entry.id !== attachmentId),
      );
      goBack();
    },
  };
}

/** The inherited attachment that already runs this evaluator, if any. */
function findInheritedAttachment({
  inherited,
  evaluatorId,
}: {
  inherited: readonly InheritedSuite[];
  evaluatorId: string;
}) {
  return inherited
    .flatMap((suite) =>
      suite.attachments.map((attachment) => ({ suite, attachment })),
    )
    .find(({ attachment }) => attachment.evaluatorId === evaluatorId);
}

/**
 * Opens the editor on one of the plan's own attachments. An evaluator just
 * created is handed in, since the list has not read it back yet.
 */
function useOpenExtraEditor({
  evaluatorsById,
  openEvaluatorEditor,
  setExtras,
  goBack,
}: {
  evaluatorsById: ReadonlyMap<string, AttachableEvaluator>;
  openEvaluatorEditor: ReturnType<typeof useOpenScenarioEvaluatorEditor>;
  setExtras: SetExtras;
  goBack: () => void;
}) {
  return useCallback(
    ({
      attachment,
      evaluator,
      navigation,
    }: {
      attachment: EvaluatorAttachment;
      evaluator?: AttachableEvaluator;
      navigation?: { replaceCurrentInStack?: boolean };
    }) => {
      const resolvedEvaluator =
        evaluator ?? evaluatorsById.get(attachment.evaluatorId);
      if (!resolvedEvaluator) return;
      openEvaluatorEditor({
        attachment,
        evaluator: resolvedEvaluator,
        ctx: PLAN_CTX,
        isPlanLevel: true,
        navigation,
        ...buildExtraEditorCallbacks({
          attachmentId: attachment.id,
          setExtras,
          goBack,
        }),
      });
    },
    [evaluatorsById, openEvaluatorEditor, setExtras, goBack],
  );
}

/**
 * Editing one of the plan's own attachments, and attaching a pick: `editExtra`
 * takes a single attachment, since it doubles as the click handler a pill
 * hands it, while `attach` also carries the evaluator a pick already has.
 */
export function useEditAndAttachExtra({
  inherited,
  extras,
  openInherited,
  evaluatorsById,
  openEvaluatorEditor,
  setExtras,
  goBack,
}: {
  inherited: readonly InheritedSuite[];
  extras: EvaluatorAttachment[];
  openInherited: (params: { suiteId: string; attachmentId: string }) => void;
  evaluatorsById: ReadonlyMap<string, AttachableEvaluator>;
  openEvaluatorEditor: ReturnType<typeof useOpenScenarioEvaluatorEditor>;
  setExtras: SetExtras;
  goBack: () => void;
}) {
  const openExtraEditor = useOpenExtraEditor({
    evaluatorsById,
    openEvaluatorEditor,
    setExtras,
    goBack,
  });

  const editExtra = useCallback(
    (attachment: EvaluatorAttachment) => openExtraEditor({ attachment }),
    [openExtraEditor],
  );

  const attach = useCallback(
    (evaluator: EvaluatorWithFields) => {
      const fromSuite = findInheritedAttachment({
        inherited,
        evaluatorId: evaluator.id,
      });
      if (fromSuite) {
        openInherited({
          suiteId: fromSuite.suite.suiteId,
          attachmentId: fromSuite.attachment.id,
        });
        return;
      }
      const already = extras.find(
        (attachment) => attachment.evaluatorId === evaluator.id,
      );
      if (already) {
        openExtraEditor({
          attachment: already,
          evaluator,
          navigation: { replaceCurrentInStack: true },
        });
        return;
      }
      const attachment = newAttachment({
        evaluator,
        ctx: PLAN_CTX,
        isPlanLevel: true,
      });
      setExtras((current) => [...current, attachment]);
      if (opensOnAttach({ attachment, evaluator })) {
        openExtraEditor({
          attachment,
          evaluator,
          navigation: { replaceCurrentInStack: true },
        });
        return;
      }
      goBack();
    },
    [inherited, extras, openInherited, openExtraEditor, setExtras, goBack],
  );

  return { editExtra, attach };
}

/**
 * The plan's own evaluator flow: editing one of its attachments, attaching
 * a pick, and the toggles around the block.
 */
export function useExtraEvaluatorsFlow({
  inherited,
  extras,
  openInherited,
  evaluatorsById,
  openEvaluatorEditor,
  setExtras,
  goBack,
  openDrawer,
  closeDrawer,
  utils,
  projectId,
  setShowExtras,
}: {
  inherited: readonly InheritedSuite[];
  extras: EvaluatorAttachment[];
  openInherited: (params: { suiteId: string; attachmentId: string }) => void;
  evaluatorsById: ReadonlyMap<string, AttachableEvaluator>;
  openEvaluatorEditor: ReturnType<typeof useOpenScenarioEvaluatorEditor>;
  setExtras: SetExtras;
  goBack: () => void;
  openDrawer: ReturnType<typeof useDrawer>["openDrawer"];
  closeDrawer: ReturnType<typeof useDrawer>["closeDrawer"];
  utils: ReturnType<typeof api.useUtils>;
  projectId: string;
  setShowExtras: (isShown: boolean) => void;
}) {
  const { editExtra, attach } = useEditAndAttachExtra({
    inherited,
    extras,
    openInherited,
    evaluatorsById,
    openEvaluatorEditor,
    setExtras,
    goBack,
  });

  const { addExtra, showEvaluatorsBlock, removeEvaluatorsBlock } =
    useAddExtraFlow({
      attach,
      evaluatorsById,
      openDrawer,
      closeDrawer,
      utils,
      projectId,
      setShowExtras,
      setExtras,
    });

  return { editExtra, addExtra, showEvaluatorsBlock, removeEvaluatorsBlock };
}
