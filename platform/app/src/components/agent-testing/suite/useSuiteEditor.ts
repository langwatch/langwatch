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
import { showErrorToast } from "~/features/errors";
import { getDrawerStack, useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useProjectSpanNames } from "~/hooks/useProjectSpanNames";
import {
  type EvaluatorAttachment,
  type EvaluatorInputSpec,
  parseEvaluatorAttachments,
  type ScenarioMappingContext,
} from "~/server/scenarios/evaluator-attachments";
import { parseSuiteFieldDefinitions } from "~/server/scenarios/suite-fields";
import { api } from "~/utils/api";
import { SUITE_EDITOR_DRAWER } from "../cases/drawerKeys";
import type { AttachableEvaluator } from "../evaluators/attachment-rules";
import type { CustomizeChip } from "../shared/CustomizeChips";
import {
  type SuiteDraft,
  type SuiteFieldRow,
  useSuiteEditorStore,
} from "./suiteEditorStore";
import {
  definitionsOf,
  placeServerRefusal,
  refusalsOf,
} from "./suiteEditorValidation";
import {
  usePendingAttachmentEditor,
  useSuiteAttachments,
} from "./useSuiteAttachments";

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
    reorder: (input: { from: number; to: number }) => void;
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
      reorder: ({ from, to }: { from: number; to: number }) =>
        update((draft) => {
          if (to < 0 || to >= draft.fields.length) return draft;
          const fields = [...draft.fields];
          const [row] = fields.splice(from, 1);
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

/** The sections not open yet, offered as chips in the order shown. */
function suiteChipsOf({
  draft,
  openFields,
  openEvaluators,
}: {
  draft: SuiteDraft | null;
  openFields: () => void;
  openEvaluators: () => void;
}): CustomizeChip[] {
  const chips: CustomizeChip[] = [];
  if (draft && !draft.showFields) {
    chips.push({ key: "suite-fields", label: "Add fields", onAdd: openFields });
  }
  if (draft && !draft.showEvaluators) {
    chips.push({
      key: "suite-evaluators",
      label: "Add evaluators",
      onAdd: openEvaluators,
    });
  }
  return chips;
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

  usePendingAttachmentEditor({
    isOpen,
    draft,
    edit: evaluators.edit,
    evaluatorsById: evaluators.evaluatorsById,
  });

  const chips = suiteChipsOf({
    draft,
    openFields: fields.open,
    openEvaluators: evaluators.open,
  });

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
