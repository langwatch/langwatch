/**
 * Opens the evaluator list for a pick, without the evaluators a run plan
 * cannot feed, and the toggles that show or clear the plan's evaluators
 * block.
 *
 * @see specs/features/agent-testing/run-dialog.feature
 */

import { useCallback } from "react";
import { createEvaluatorEditorCallbacks } from "~/experiments-v3/utils/evaluatorEditorCallbacks";
import { setFlowCallbacks, type useDrawer } from "~/hooks/useDrawer";
import type { EvaluatorWithFields } from "~/server/evaluators/evaluator.service";
import type { api } from "~/utils/api";
import {
  type AttachableEvaluator,
  evaluatorFitsPlanLevel,
} from "../evaluators/attachment-rules";
import type { SetExtras } from "./useEditAndAttachExtra";

/** The evaluator ids a run plan cannot feed, hidden from the attach list. */
export function hiddenEvaluatorIdsOf(
  evaluatorsById: ReadonlyMap<string, AttachableEvaluator>,
): string[] {
  return [...evaluatorsById.values()]
    .filter((evaluator) => !evaluatorFitsPlanLevel(evaluator))
    .map((evaluator) => evaluator.id);
}

/** Opens the list, without the evaluators a run plan cannot feed, and the toggles around it. */
export function useAddExtraFlow({
  attach,
  evaluatorsById,
  openDrawer,
  closeDrawer,
  utils,
  projectId,
  setShowExtras,
  setExtras,
}: {
  attach: (evaluator: EvaluatorWithFields) => void;
  evaluatorsById: ReadonlyMap<string, AttachableEvaluator>;
  openDrawer: ReturnType<typeof useDrawer>["openDrawer"];
  closeDrawer: ReturnType<typeof useDrawer>["closeDrawer"];
  utils: ReturnType<typeof api.useUtils>;
  projectId: string;
  setShowExtras: (isShown: boolean) => void;
  setExtras: SetExtras;
}) {
  const addExtra = useCallback(() => {
    setFlowCallbacks("evaluatorList", { onSelect: attach });
    // An evaluator created from the list is attached like a picked one once
    // it is saved, and the flow lands back on the dialog.
    setFlowCallbacks(
      "evaluatorEditor",
      createEvaluatorEditorCallbacks({
        onSave: async (saved) => {
          const evaluator = await utils.evaluators.getById.fetch({
            id: saved.id,
            projectId,
          });
          closeDrawer();
          if (evaluator) attach(evaluator);
          return true;
        },
      }),
    );
    openDrawer("evaluatorList", {
      hiddenEvaluatorIds: hiddenEvaluatorIdsOf(evaluatorsById),
    });
  }, [attach, evaluatorsById, openDrawer, closeDrawer, utils, projectId]);

  const showEvaluatorsBlock = useCallback(() => {
    setShowExtras(true);
    addExtra();
  }, [setShowExtras, addExtra]);

  const removeEvaluatorsBlock = useCallback(() => {
    setShowExtras(false);
    setExtras(() => []);
  }, [setShowExtras, setExtras]);

  return { addExtra, showEvaluatorsBlock, removeEvaluatorsBlock };
}
