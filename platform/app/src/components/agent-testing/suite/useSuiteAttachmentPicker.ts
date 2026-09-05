/**
 * The evaluator picker and its navigation flow: picking from the list or
 * creating one, opening the right editor for a new or an already attached
 * evaluator, and wiring the mapping, gate and removal writes back into the
 * suite draft store.
 *
 * @see specs/features/agent-testing/suite-editor.feature
 */

import { useCallback } from "react";
import { createEvaluatorEditorCallbacks } from "~/experiments-v3/utils/evaluatorEditorCallbacks";
import { setFlowCallbacks, type useDrawer } from "~/hooks/useDrawer";
import type { EvaluatorWithFields } from "~/server/evaluators/evaluator.service";
import type {
  EvaluatorAttachment,
  ScenarioMapping,
  ScenarioMappingContext,
} from "~/server/scenarios/evaluator-attachments";
import type { api } from "~/utils/api";
import { SUITE_EDITOR_DRAWER } from "../cases/drawerKeys";
import {
  type AttachableEvaluator,
  newAttachment,
  opensOnAttach,
} from "../evaluators/attachment-rules";
import type { useOpenScenarioEvaluatorEditor } from "../evaluators/useOpenScenarioEvaluatorEditor";
import { type SuiteDraft, useSuiteEditorStore } from "./suiteEditorStore";

export type SuiteDraftUpdate = (
  change: (draft: SuiteDraft) => SuiteDraft,
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
 * Opens the editor for one attachment, wiring its mapping, gate and removal
 * writes back into the store.
 */
function editAttachment({
  attachment,
  evaluator,
  navigation,
  ctx,
  update,
  goBack,
  openEvaluatorEditor,
}: {
  attachment: EvaluatorAttachment;
  evaluator: AttachableEvaluator;
  navigation?: { replaceCurrentInStack?: boolean };
  ctx: ScenarioMappingContext;
  update: SuiteDraftUpdate;
  goBack: () => void;
  openEvaluatorEditor: ReturnType<typeof useOpenScenarioEvaluatorEditor>;
}) {
  const attachmentId = attachment.id;
  openEvaluatorEditor({
    attachment,
    evaluator,
    ctx,
    navigation,
    onMappingChange: (input: string, mapping: ScenarioMapping | undefined) =>
      update((draft) => ({
        ...draft,
        evaluatorsError: undefined,
        evaluators: replaceAttachment({
          attachments: draft.evaluators,
          attachmentId,
          change: (current) => {
            const mappings = { ...current.mappings };
            if (mapping) mappings[input] = mapping;
            else delete mappings[input];
            return { ...current, mappings };
          },
        }),
      })),
    onRequiredChange: (required: boolean) =>
      update((draft) => ({
        ...draft,
        evaluators: replaceAttachment({
          attachments: draft.evaluators,
          attachmentId,
          change: (current) => ({ ...current, required }),
        }),
      })),
    onRemove: () => {
      update((draft) => ({
        ...draft,
        evaluators: draft.evaluators.filter(
          (current) => current.id !== attachmentId,
        ),
      }));
      goBack();
    },
  });
}

/**
 * What a pick does: an evaluator already attached opens its editor, a new
 * one is attached with inferred mappings and opens its editor when an input
 * still needs a person.
 *
 * A pick from the list replaces the list in the stack, so back from the
 * editor lands on the suite editor. An evaluator created from the list
 * arrives once the stack is already back on the suite editor, so its editor
 * is pushed on top and nothing goes back.
 */
function attachEvaluator({
  evaluator,
  origin,
  ctx,
  update,
  edit,
  goBack,
}: {
  evaluator: EvaluatorWithFields;
  origin: "list" | "created";
  ctx: ScenarioMappingContext;
  update: SuiteDraftUpdate;
  edit: (params: {
    attachment: EvaluatorAttachment;
    evaluator: AttachableEvaluator;
    navigation?: { replaceCurrentInStack?: boolean };
  }) => void;
  goBack: () => void;
}) {
  const draft = useSuiteEditorStore.getState().draft;
  if (!draft) return;
  const navigation =
    origin === "list" ? { replaceCurrentInStack: true } : undefined;
  const already = draft.evaluators.find(
    (attachment) => attachment.evaluatorId === evaluator.id,
  );
  if (already) {
    edit({ attachment: already, evaluator, navigation });
    return;
  }
  const attachment = newAttachment({ evaluator, ctx });
  update((current) => ({
    ...current,
    showEvaluators: true,
    evaluators: [...current.evaluators, attachment],
  }));
  if (opensOnAttach({ attachment, evaluator })) {
    edit({ attachment, evaluator, navigation });
    return;
  }
  if (origin === "list") goBack();
}

/**
 * Opens the evaluator list for a pick, and wires the flow that lets a person
 * create an evaluator from it instead: once it is saved, the stack resets to
 * this drawer and the evaluator is attached like a picked one, so its editor
 * sits on top of the suite editor.
 */
export function openEvaluatorPicker({
  attach,
  openDrawer,
  goBack,
  utils,
  projectId,
  testSuiteId,
}: {
  attach: (params: {
    evaluator: EvaluatorWithFields;
    origin?: "list" | "created";
  }) => void;
  openDrawer: ReturnType<typeof useDrawer>["openDrawer"];
  goBack: () => void;
  utils: ReturnType<typeof api.useUtils>;
  projectId: string;
  testSuiteId: string | null;
}) {
  setFlowCallbacks("evaluatorList", {
    onSelect: (evaluator) => attach({ evaluator, origin: "list" }),
  });
  setFlowCallbacks(
    "evaluatorEditor",
    createEvaluatorEditorCallbacks({
      onSave: async (saved) => {
        const evaluator = await utils.evaluators.getById.fetch({
          id: saved.id,
          projectId,
        });
        if (testSuiteId) {
          openDrawer(
            SUITE_EDITOR_DRAWER,
            { testSuiteId },
            { resetStack: true },
          );
        }
        if (evaluator) attach({ evaluator, origin: "created" });
        return true;
      },
    }),
  );
  openDrawer("evaluatorList", { onClose: goBack });
}

/** The `edit` and `attach` callbacks, wired to the draft store and the drawer. */
export function useSuiteAttachmentEditing({
  ctx,
  update,
  goBack,
  openEvaluatorEditor,
}: {
  ctx: ScenarioMappingContext;
  update: SuiteDraftUpdate;
  goBack: () => void;
  openEvaluatorEditor: ReturnType<typeof useOpenScenarioEvaluatorEditor>;
}) {
  const edit = useCallback(
    ({
      attachment,
      evaluator,
      navigation,
    }: {
      attachment: EvaluatorAttachment;
      evaluator: AttachableEvaluator;
      navigation?: { replaceCurrentInStack?: boolean };
    }) =>
      editAttachment({
        attachment,
        evaluator,
        navigation,
        ctx,
        update,
        goBack,
        openEvaluatorEditor,
      }),
    [openEvaluatorEditor, ctx, update, goBack],
  );

  const attach = useCallback(
    ({
      evaluator,
      origin = "list",
    }: {
      evaluator: EvaluatorWithFields;
      origin?: "list" | "created";
    }) => attachEvaluator({ evaluator, origin, ctx, update, edit, goBack }),
    [ctx, edit, update, goBack],
  );

  return { edit, attach };
}
