/**
 * The state and the writes of the suite editor.
 *
 * The draft is seeded from the stored suite when the drawer opens on it, and
 * kept in the suite editor store while the person is away in the evaluator
 * list or the evaluator editor. Every pick and every mapping edit writes into
 * that store, so the drawer reads the same draft when it comes back.
 *
 * @see specs/features/agent-testing/suite-editor.feature
 * @see specs/suites/test-suites.feature
 */

import { nanoid } from "nanoid";
import { useCallback, useEffect, useMemo } from "react";
import { toaster } from "~/components/ui/toaster";
import { createEvaluatorEditorCallbacks } from "~/experiments-v3/utils/evaluatorEditorCallbacks";
import {
  describeError,
  readHandledError,
  showErrorToast,
} from "~/features/errors";
import { getDrawerStack, setFlowCallbacks, useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useProjectSpanNames } from "~/hooks/useProjectSpanNames";
import type { EvaluatorWithFields } from "~/server/evaluators/evaluator.service";
import {
  type EvaluatorAttachment,
  type EvaluatorInputSpec,
  parseEvaluatorAttachments,
  type ScenarioMapping,
  type ScenarioMappingContext,
} from "~/server/scenarios/evaluator-attachments";
import {
  parseSuiteFieldDefinitions,
  SUITE_FIELD_IDENTIFIER_DUPLICATE_MESSAGE,
  type SuiteFieldDefinition,
  suiteFieldDefinitionSchema,
} from "~/server/scenarios/suite-fields";
import { api } from "~/utils/api";
import { SUITE_EDITOR_DRAWER } from "../cases/drawerKeys";
import { SUITE_NAME_REQUIRED } from "../cases/SuiteNameDialog";
import {
  type AttachableEvaluator,
  missingInputsOf,
  newAttachment,
  opensOnAttach,
} from "../evaluators/attachment-rules";
import { useOpenScenarioEvaluatorEditor } from "../evaluators/useOpenScenarioEvaluatorEditor";
import { useProjectEvaluators } from "../evaluators/useProjectEvaluators";
import type { CustomizeChip } from "../shared/CustomizeChips";
import {
  type SuiteDraft,
  type SuiteFieldRow,
  useSuiteEditorStore,
} from "./suiteEditorStore";

/** What the editor says about a row with no identifier. */
export const FIELD_IDENTIFIER_REQUIRED = "A field needs an identifier.";

/** A fresh row, empty and ready to be named. */
function freshRow(): SuiteFieldRow {
  return { key: nanoid(), identifier: "", type: "text" };
}

/** The draft a stored suite reads as. */
function draftFromSuite(suite: {
  name: string;
  fields: unknown;
  evaluators: unknown;
}): SuiteDraft {
  const fields = parseSuiteFieldDefinitions(suite.fields);
  const evaluators = parseEvaluatorAttachments(suite.evaluators);
  return {
    name: suite.name,
    showFields: fields.length > 0,
    fields: fields.map((field) => ({ key: nanoid(), ...field })),
    showEvaluators: evaluators.length > 0,
    evaluators,
  };
}

/** The definitions the rows declare, in order. */
function definitionsOf(rows: readonly SuiteFieldRow[]): SuiteFieldDefinition[] {
  return rows.map((row) => ({
    identifier: row.identifier.trim(),
    type: row.type,
  }));
}

/**
 * What the editor refuses before it saves: an empty name, an empty or
 * malformed identifier, and two rows with one identifier. Returns the draft
 * with the refusals written on it, or nothing when the draft is complete.
 */
function refusalsOf(draft: SuiteDraft): SuiteDraft | null {
  let refused = false;
  const seen = new Set<string>();
  const fields = draft.fields.map((row) => {
    const identifier = row.identifier.trim();
    let error: string | undefined;
    if (identifier === "") {
      error = FIELD_IDENTIFIER_REQUIRED;
    } else {
      const parsed = suiteFieldDefinitionSchema.safeParse({
        identifier,
        type: row.type,
      });
      const issues = parsed.success ? [] : parsed.error.issues;
      if (issues[0]) error = issues[0].message;
      else if (seen.has(identifier))
        error = SUITE_FIELD_IDENTIFIER_DUPLICATE_MESSAGE;
      seen.add(identifier);
    }
    if (error) refused = true;
    return { ...row, error };
  });
  const nameError = draft.name.trim() === "" ? SUITE_NAME_REQUIRED : undefined;
  if (nameError) refused = true;
  if (!refused) return null;
  return { ...draft, nameError, fields, fieldsError: undefined };
}

/**
 * Places a refusal the server named onto the draft: an identifier refusal
 * under its row, a field or evaluator refusal under its section. Anything
 * else is not the editor's to place, and reads as a toast.
 */
function placeServerRefusal({
  draft,
  error,
}: {
  draft: SuiteDraft;
  error: unknown;
}): SuiteDraft | null {
  const handled = readHandledError(error);
  if (!handled) return null;
  const message = describeError({ error });
  const identifier =
    typeof handled.meta.identifier === "string" ? handled.meta.identifier : "";
  switch (handled.code) {
    case "suite_field_identifier_invalid":
    case "suite_field_identifier_duplicate": {
      const at = draft.fields.findIndex(
        (row) => row.identifier.trim() === identifier,
      );
      if (at < 0) return { ...draft, fieldsError: message };
      return {
        ...draft,
        fields: draft.fields.map((row, index) =>
          index === at ? { ...row, error: message } : row,
        ),
      };
    }
    case "suite_field_in_use":
      return { ...draft, showFields: true, fieldsError: message };
    case "suite_evaluator_mapping_invalid":
    case "suite_evaluator_not_found":
      return { ...draft, evaluatorsError: message };
    default:
      return null;
  }
}

/** The attachment of one id, and the attachments with it replaced. */
function replaceAttachment(
  attachments: readonly EvaluatorAttachment[],
  attachmentId: string,
  change: (attachment: EvaluatorAttachment) => EvaluatorAttachment,
): EvaluatorAttachment[] {
  return attachments.map((attachment) =>
    attachment.id === attachmentId ? change(attachment) : attachment,
  );
}

export type SuiteEditorModel = {
  /** True until the stored suite is read and the draft seeded from it. */
  isLoading: boolean;
  /** The name the suite is stored under, for the heading. */
  storedName: string;
  draft: SuiteDraft | null;
  setName: (name: string) => void;
  fields: {
    open: () => void;
    close: () => void;
    add: () => void;
    patch: (
      index: number,
      patch: Partial<Pick<SuiteFieldRow, "identifier" | "type">>,
    ) => void;
    move: (index: number, by: -1 | 1) => void;
    remove: (index: number) => void;
  };
  evaluators: {
    open: () => void;
    close: () => void;
    /** Opens the evaluator list for a pick. */
    add: () => void;
    /** Opens the evaluator editor on one attachment. */
    edit: (attachment: EvaluatorAttachment) => void;
    evaluatorsById: ReadonlyMap<string, AttachableEvaluator>;
    missingOf: (attachment: EvaluatorAttachment) => EvaluatorInputSpec[];
  };
  /** The sections that are not open yet, in the order they are offered. */
  chips: CustomizeChip[];
  isSaving: boolean;
  save: () => void;
  /** Leaves the editor without saving. */
  close: () => void;
};

/** Reads the draft, or seeds it from the stored suite once that is read. */
function useSuiteDraft({
  testSuiteId,
  isOpen,
  suite,
}: {
  testSuiteId: string | null;
  isOpen: boolean;
  suite: { name: string; fields: unknown; evaluators: unknown } | undefined;
}) {
  const storedSuiteId = useSuiteEditorStore((state) => state.suiteId);
  const draft = useSuiteEditorStore((state) => state.draft);
  const seed = useSuiteEditorStore((state) => state.seed);
  const clear = useSuiteEditorStore((state) => state.clear);

  const hasDraft = !!draft && storedSuiteId === testSuiteId;

  useEffect(() => {
    if (!isOpen || !testSuiteId || !suite || hasDraft) return;
    seed({ suiteId: testSuiteId, draft: draftFromSuite(suite) });
  }, [isOpen, testSuiteId, suite, hasDraft, seed]);

  // Leaving for the evaluator list or the evaluator editor keeps the draft:
  // the drawer stays in the stack and the person comes back to it. Closing
  // empties the stack, and the draft goes with it.
  useEffect(() => {
    if (!isOpen) return;
    return () => {
      const stillOpen = getDrawerStack().some(
        (entry) => entry.drawer === SUITE_EDITOR_DRAWER,
      );
      if (!stillOpen) clear();
    };
  }, [isOpen, clear]);

  return hasDraft ? draft : null;
}

/** The one write the editor makes, and where its refusals land. */
function useSuiteSave({
  projectId,
  testSuiteId,
  onSaved,
}: {
  projectId: string;
  testSuiteId: string | null;
  onSaved: () => void;
}) {
  const utils = api.useUtils();
  const update = useSuiteEditorStore((state) => state.update);

  const mutation = api.suites.testSuites.update.useMutation({
    onSuccess: (saved) => {
      void utils.suites.testSuites.getAll.invalidate({ projectId });
      void utils.suites.getById.invalidate({ projectId, id: saved.id });
      toaster.create({ title: "Test suite updated", type: "success" });
      onSaved();
    },
    onError: (error) => {
      let placed = false;
      update((draft) => {
        const next = placeServerRefusal({ draft, error });
        placed = next !== null;
        return next ?? draft;
      });
      if (!placed) {
        showErrorToast({
          error,
          fallbackTitle: "Couldn't save the test suite",
        });
      }
    },
  });

  const save = useCallback(() => {
    const draft = useSuiteEditorStore.getState().draft;
    if (!draft || !testSuiteId) return;
    const refused = refusalsOf(draft);
    if (refused) {
      update(() => refused);
      return;
    }
    update((current) => ({
      ...current,
      nameError: undefined,
      fieldsError: undefined,
      evaluatorsError: undefined,
      fields: current.fields.map((row) => ({ ...row, error: undefined })),
    }));
    mutation.mutate({
      projectId,
      testSuiteId,
      name: draft.name.trim(),
      fields: draft.showFields ? definitionsOf(draft.fields) : [],
      evaluators: draft.showEvaluators ? draft.evaluators : [],
    });
  }, [mutation, projectId, testSuiteId, update]);

  return { save, isSaving: mutation.isPending };
}

/** The field rows: opening the section, and editing what it holds. */
function useSuiteFieldRows() {
  const update = useSuiteEditorStore((state) => state.update);

  return useMemo(
    () => ({
      // The section opens with its first row in place, ready to be named.
      open: () =>
        update((draft) => ({
          ...draft,
          showFields: true,
          fields: draft.fields.length > 0 ? draft.fields : [freshRow()],
        })),
      close: () =>
        update((draft) => ({
          ...draft,
          showFields: false,
          fields: [],
          fieldsError: undefined,
        })),
      add: () =>
        update((draft) => ({
          ...draft,
          fields: [...draft.fields, freshRow()],
        })),
      patch: (
        index: number,
        patch: Partial<Pick<SuiteFieldRow, "identifier" | "type">>,
      ) =>
        update((draft) => ({
          ...draft,
          fields: draft.fields.map((row, at) =>
            at === index ? { ...row, ...patch, error: undefined } : row,
          ),
        })),
      move: (index: number, by: -1 | 1) =>
        update((draft) => {
          const to = index + by;
          if (to < 0 || to >= draft.fields.length) return draft;
          const fields = [...draft.fields];
          const [row] = fields.splice(index, 1);
          if (!row) return draft;
          fields.splice(to, 0, row);
          return { ...draft, fields };
        }),
      remove: (index: number) =>
        update((draft) => ({
          ...draft,
          fields: draft.fields.filter((_, at) => at !== index),
        })),
    }),
    [update],
  );
}

/**
 * The evaluators of the draft: the list to pick from, the editor of one
 * attachment, and the writes both of them make into the store.
 *
 * The pick and the edits run while this drawer is unmounted, so every one of
 * them reads and writes the store rather than a render's draft.
 */
function useSuiteAttachments({
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

  const edit = useCallback(
    (
      attachment: EvaluatorAttachment,
      evaluator: AttachableEvaluator,
      navigation?: { replaceCurrentInStack?: boolean },
    ) => {
      const attachmentId = attachment.id;
      openEvaluatorEditor({
        attachment,
        evaluator,
        ctx,
        navigation,
        onMappingChange: (
          input: string,
          mapping: ScenarioMapping | undefined,
        ) =>
          update((draft) => ({
            ...draft,
            evaluatorsError: undefined,
            evaluators: replaceAttachment(
              draft.evaluators,
              attachmentId,
              (current) => {
                const mappings = { ...current.mappings };
                if (mapping) mappings[input] = mapping;
                else delete mappings[input];
                return { ...current, mappings };
              },
            ),
          })),
        onRequiredChange: (required: boolean) =>
          update((draft) => ({
            ...draft,
            evaluators: replaceAttachment(
              draft.evaluators,
              attachmentId,
              (current) => ({ ...current, required }),
            ),
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
    },
    [openEvaluatorEditor, ctx, update, goBack],
  );

  const editById = useCallback(
    (attachment: EvaluatorAttachment) => {
      const evaluator = evaluatorsById.get(attachment.evaluatorId);
      if (evaluator) edit(attachment, evaluator);
    },
    [edit, evaluatorsById],
  );

  /**
   * What a pick does: an evaluator already attached opens its editor, a new
   * one is attached with inferred mappings and opens its editor when an
   * input still needs a person.
   *
   * A pick from the list replaces the list in the stack, so back from the
   * editor lands on the suite editor. An evaluator created from the list
   * arrives once the stack is already back on the suite editor, so its
   * editor is pushed on top and nothing goes back.
   */
  const attach = useCallback(
    (evaluator: EvaluatorWithFields, origin: "list" | "created" = "list") => {
      const draft = useSuiteEditorStore.getState().draft;
      if (!draft) return;
      const navigation =
        origin === "list" ? { replaceCurrentInStack: true } : undefined;
      const already = draft.evaluators.find(
        (attachment) => attachment.evaluatorId === evaluator.id,
      );
      if (already) {
        edit(already, evaluator, navigation);
        return;
      }
      const attachment = newAttachment({ evaluator, ctx });
      update((current) => ({
        ...current,
        showEvaluators: true,
        evaluators: [...current.evaluators, attachment],
      }));
      if (opensOnAttach({ attachment, evaluator })) {
        edit(attachment, evaluator, navigation);
        return;
      }
      if (origin === "list") goBack();
    },
    [ctx, edit, update, goBack],
  );

  const add = useCallback(() => {
    setFlowCallbacks("evaluatorList", {
      onSelect: (evaluator) => attach(evaluator, "list"),
    });
    // A person may create an evaluator from the list. Once it is saved, the
    // stack is reset to this drawer and the evaluator is attached like a
    // picked one, so its editor sits on top of the suite editor.
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
          if (evaluator) attach(evaluator, "created");
          return true;
        },
      }),
    );
    openDrawer("evaluatorList", { onClose: goBack });
  }, [attach, openDrawer, goBack, utils, projectId, testSuiteId]);

  return useMemo(
    () => ({
      open: () => {
        update((draft) => ({ ...draft, showEvaluators: true }));
        add();
      },
      close: () =>
        update((draft) => ({
          ...draft,
          showEvaluators: false,
          evaluators: [],
          evaluatorsError: undefined,
        })),
      add,
      edit: editById,
      evaluatorsById,
      missingOf,
    }),
    [update, add, editById, evaluatorsById, missingOf],
  );
}

export function useSuiteEditor({
  testSuiteId,
  isOpen,
}: {
  testSuiteId: string | null;
  isOpen: boolean;
}): SuiteEditorModel {
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id ?? "";
  const { closeDrawer } = useDrawer();
  const update = useSuiteEditorStore((state) => state.update);
  const clear = useSuiteEditorStore((state) => state.clear);
  const pendingAttachmentId = useSuiteEditorStore(
    (state) => state.pendingAttachmentId,
  );
  const setPendingAttachmentId = useSuiteEditorStore(
    (state) => state.setPendingAttachmentId,
  );

  const { data: suite, isLoading: isSuiteLoading } =
    api.suites.getById.useQuery(
      { projectId, id: testSuiteId ?? "" },
      { enabled: isOpen && !!projectId && !!testSuiteId },
    );

  const draft = useSuiteDraft({ testSuiteId, isOpen, suite });

  // The tool calls a mapping may read are the spans the project has seen.
  const { spanNames } = useProjectSpanNames({
    projectId: isOpen ? projectId : undefined,
  });
  const ctx = useMemo<ScenarioMappingContext>(
    () => ({
      fields: draft?.showFields
        ? definitionsOf(draft.fields).filter((field) => field.identifier)
        : [],
      toolNames: spanNames.map((span) => span.key),
    }),
    [draft?.showFields, draft?.fields, spanNames],
  );

  const fields = useSuiteFieldRows();
  const evaluators = useSuiteAttachments({ ctx, testSuiteId });

  const close = useCallback(() => {
    clear();
    closeDrawer();
  }, [clear, closeDrawer]);

  const { save, isSaving } = useSuiteSave({
    projectId,
    testSuiteId,
    onSaved: close,
  });

  // A pill outside the drawer asked for one attachment's editor: open it as
  // soon as the draft and the evaluator are here, and only once.
  const { edit, evaluatorsById } = evaluators;
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

  const chips: CustomizeChip[] = [];
  if (draft && !draft.showFields) {
    chips.push({
      key: "suite-fields",
      label: "Add fields",
      onAdd: fields.open,
    });
  }
  if (draft && !draft.showEvaluators) {
    chips.push({
      key: "suite-evaluators",
      label: "Add evaluators",
      onAdd: evaluators.open,
    });
  }

  return {
    isLoading: isOpen && (isSuiteLoading || !draft),
    storedName: suite?.name ?? "",
    draft,
    setName: (name) =>
      update((current) => ({ ...current, name, nameError: undefined })),
    fields,
    evaluators,
    chips,
    isSaving,
    save,
    close,
  };
}
