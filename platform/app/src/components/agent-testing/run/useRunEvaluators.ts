/**
 * The evaluators of an open run dialog: the ones inherited from the suites
 * in scope, the plan's own extras, the editors both open, and the guard
 * that sends Run to an evaluator whose input still reads nothing.
 *
 * The extras live in the plan fields, so they reset with the subject and
 * travel with the run. The inherited ones are read off the suites in scope
 * and edited in the suite editor, never here.
 *
 * @see specs/features/agent-testing/run-dialog.feature
 */

import { useCallback, useMemo } from "react";
import { createEvaluatorEditorCallbacks } from "~/experiments-v3/utils/evaluatorEditorCallbacks";
import { readHandledError } from "~/features/errors";
import { setFlowCallbacks, useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { EvaluatorWithFields } from "~/server/evaluators/evaluator.service";
import {
  type EvaluatorAttachment,
  parseEvaluatorAttachments,
  type ScenarioMapping,
} from "~/server/scenarios/evaluator-attachments";
import { api } from "~/utils/api";
import { useRouter } from "~/utils/compat/next-router";
import {
  type AttachableEvaluator,
  evaluatorFitsPlanLevel,
  missingInputsOf,
  newAttachment,
  opensOnAttach,
} from "../evaluators/attachment-rules";
import { useOpenScenarioEvaluatorEditor } from "../evaluators/useOpenScenarioEvaluatorEditor";
import { useProjectEvaluators } from "../evaluators/useProjectEvaluators";
import { useOpenSuiteEditor } from "../suite/useOpenSuiteEditor";
import type { ScopeScenario } from "./RunScopeSection";
import type { RunScope } from "./run-configuration";
import {
  type EvaluatorOffender,
  firstEvaluatorOffender,
  inheritedSuitesOf,
  isEvaluatorFlowDrawer,
  type SuiteRow,
  suiteIdsInScope,
} from "./run-evaluators";

/** A plan level attachment reads no scenario field. */
const PLAN_CTX = { fields: [], toolNames: [] };

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
  setExtras: RunEvaluatorsInput["setExtras"];
  goBack: () => void;
}) {
  return {
    onMappingChange: (input: string, mapping: ScenarioMapping | undefined) =>
      setExtras((current) =>
        replaceAttachment(current, attachmentId, (entry) => {
          const mappings = { ...entry.mappings };
          if (mapping) mappings[input] = mapping;
          else delete mappings[input];
          return { ...entry, mappings };
        }),
      ),
    onRequiredChange: (required: boolean) =>
      setExtras((current) =>
        replaceAttachment(current, attachmentId, (entry) => ({
          ...entry,
          required,
        })),
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
  inherited: readonly ReturnType<typeof inheritedSuitesOf>[number][];
  evaluatorId: string;
}) {
  return inherited
    .flatMap((suite) =>
      suite.attachments.map((attachment) => ({ suite, attachment })),
    )
    .find(({ attachment }) => attachment.evaluatorId === evaluatorId);
}

/** The evaluator ids a run plan cannot feed, hidden from the attach list. */
function hiddenEvaluatorIdsOf(
  evaluatorsById: ReadonlyMap<string, AttachableEvaluator>,
): string[] {
  return [...evaluatorsById.values()]
    .filter((evaluator) => !evaluatorFitsPlanLevel(evaluator))
    .map((evaluator) => evaluator.id);
}

/**
 * Where a `suite_evaluator_mappings_missing` refusal is fixed: the suite
 * attachment it names, or the plan's own attachment. `null` when the error
 * is not this refusal, or names nothing we can open.
 */
function resolveMappingsMissingTarget({
  error,
  testSuites,
  extras,
}: {
  error: unknown;
  testSuites: readonly SuiteRow[];
  extras: readonly EvaluatorAttachment[];
}):
  | { kind: "suite"; suiteId: string; attachmentId: string }
  | { kind: "extra"; attachment: EvaluatorAttachment }
  | null {
  const handled = readHandledError(error);
  if (handled?.code !== "suite_evaluator_mappings_missing") return null;
  const { suiteId, evaluatorId } = handled.meta;
  if (typeof evaluatorId !== "string") return null;
  const suite = testSuites.find((row) => row.id === suiteId);
  const attachment = suite
    ? parseEvaluatorAttachments(suite.evaluators).find(
        (entry) => entry.evaluatorId === evaluatorId,
      )
    : undefined;
  if (suite && attachment) {
    return { kind: "suite", suiteId: suite.id, attachmentId: attachment.id };
  }
  const extra = extras.find((entry) => entry.evaluatorId === evaluatorId);
  return extra ? { kind: "extra", attachment: extra } : null;
}

/** The evaluators inherited from the suites in scope, and the offender. */
function useInheritedEvaluators({
  scope,
  scopedScenarioIds,
  scopeScenarios,
  testSuites,
  evaluatorsById,
  extras,
}: {
  scope: RunScope;
  scopedScenarioIds: readonly string[];
  scopeScenarios: readonly ScopeScenario[];
  testSuites: readonly SuiteRow[];
  evaluatorsById: ReadonlyMap<string, AttachableEvaluator>;
  extras: EvaluatorAttachment[];
}) {
  const inherited = useMemo(
    () =>
      inheritedSuitesOf({
        suiteIds: suiteIdsInScope({
          scope,
          scopedScenarioIds,
          scenarios: scopeScenarios,
          allSuiteIds: testSuites.map((suite) => suite.id),
        }),
        testSuites,
      }),
    [scope, scopedScenarioIds, scopeScenarios, testSuites],
  );

  const missingOf = useCallback(
    (attachment: EvaluatorAttachment) =>
      missingInputsOf({
        attachment,
        evaluator: evaluatorsById.get(attachment.evaluatorId),
      }),
    [evaluatorsById],
  );

  const offender = useMemo<EvaluatorOffender | null>(
    () => firstEvaluatorOffender({ inherited, extras, evaluatorsById }),
    [inherited, extras, evaluatorsById],
  );

  return { inherited, missingOf, offender };
}

/**
 * Opens the editor on one of the plan's own attachments. An evaluator just
 * created is handed in, since the list has not read it back yet.
 */
function useEditExtra({
  evaluatorsById,
  openEvaluatorEditor,
  setExtras,
  goBack,
}: {
  evaluatorsById: ReadonlyMap<string, AttachableEvaluator>;
  openEvaluatorEditor: ReturnType<typeof useOpenScenarioEvaluatorEditor>;
  setExtras: RunEvaluatorsInput["setExtras"];
  goBack: () => void;
}) {
  return useCallback(
    (
      attachment: EvaluatorAttachment,
      options?: {
        evaluator?: AttachableEvaluator;
        navigation?: { replaceCurrentInStack?: boolean };
      },
    ) => {
      const evaluator =
        options?.evaluator ?? evaluatorsById.get(attachment.evaluatorId);
      if (!evaluator) return;
      openEvaluatorEditor({
        attachment,
        evaluator,
        ctx: PLAN_CTX,
        planLevel: true,
        navigation: options?.navigation,
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
 * What a pick does: an evaluator a suite in scope carries is edited there,
 * one the plan already has opens its editor, and a new one is attached
 * with the conversation and the trace inferred.
 */
function useAttachEvaluator({
  inherited,
  extras,
  openInherited,
  editExtra,
  setExtras,
  goBack,
}: {
  inherited: readonly ReturnType<typeof inheritedSuitesOf>[number][];
  extras: EvaluatorAttachment[];
  openInherited: (params: { suiteId: string; attachmentId: string }) => void;
  editExtra: ReturnType<typeof useEditExtra>;
  setExtras: RunEvaluatorsInput["setExtras"];
  goBack: () => void;
}) {
  return useCallback(
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
        editExtra(already, {
          evaluator,
          navigation: { replaceCurrentInStack: true },
        });
        return;
      }
      const attachment = newAttachment({
        evaluator,
        ctx: PLAN_CTX,
        planLevel: true,
      });
      setExtras((current) => [...current, attachment]);
      if (opensOnAttach({ attachment, evaluator })) {
        editExtra(attachment, {
          evaluator,
          navigation: { replaceCurrentInStack: true },
        });
        return;
      }
      goBack();
    },
    [inherited, extras, openInherited, editExtra, setExtras, goBack],
  );
}

/** Opens the list, without the evaluators a run plan cannot feed, and the toggles around it. */
function useAddExtraFlow({
  attach,
  evaluatorsById,
  openDrawer,
  closeDrawer,
  utils,
  projectId,
  setShowExtras,
  setExtras,
}: {
  attach: ReturnType<typeof useAttachEvaluator>;
  evaluatorsById: ReadonlyMap<string, AttachableEvaluator>;
  openDrawer: ReturnType<typeof useDrawer>["openDrawer"];
  closeDrawer: ReturnType<typeof useDrawer>["closeDrawer"];
  utils: ReturnType<typeof api.useUtils>;
  projectId: string;
  setShowExtras: (show: boolean) => void;
  setExtras: RunEvaluatorsInput["setExtras"];
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

/**
 * Every action the dialog can take on an evaluator: opening one, attaching
 * one, adding or clearing the extras block, and reaching the offender or a
 * mappings-missing refusal. Grouped into one hook so `useRunEvaluators`
 * itself stays a thin composition of its parts.
 */
function useRunEvaluatorsActions({
  inherited,
  extras,
  setExtras,
  evaluatorsById,
  openEvaluatorEditor,
  openSuiteEditor,
  goBack,
  offender,
  testSuites,
  openDrawer,
  closeDrawer,
  utils,
  projectId,
  setShowExtras,
}: {
  inherited: readonly ReturnType<typeof inheritedSuitesOf>[number][];
  extras: EvaluatorAttachment[];
  setExtras: RunEvaluatorsInput["setExtras"];
  evaluatorsById: ReadonlyMap<string, AttachableEvaluator>;
  openEvaluatorEditor: ReturnType<typeof useOpenScenarioEvaluatorEditor>;
  openSuiteEditor: ReturnType<typeof useOpenSuiteEditor>;
  goBack: () => void;
  offender: EvaluatorOffender | null;
  testSuites: readonly SuiteRow[];
  openDrawer: ReturnType<typeof useDrawer>["openDrawer"];
  closeDrawer: ReturnType<typeof useDrawer>["closeDrawer"];
  utils: ReturnType<typeof api.useUtils>;
  projectId: string;
  setShowExtras: (show: boolean) => void;
}) {
  const openInherited = useCallback(
    ({ suiteId, attachmentId }: { suiteId: string; attachmentId: string }) =>
      openSuiteEditor({ testSuiteId: suiteId, attachmentId }),
    [openSuiteEditor],
  );

  const editExtra = useEditExtra({
    evaluatorsById,
    openEvaluatorEditor,
    setExtras,
    goBack,
  });

  const attach = useAttachEvaluator({
    inherited,
    extras,
    openInherited,
    editExtra,
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

  const { openOffender, openMappingsMissingRefusal } = useOffenderActions({
    offender,
    openInherited,
    editExtra,
    testSuites,
    extras,
  });

  return {
    openInherited,
    editExtra,
    addExtra,
    showEvaluatorsBlock,
    removeEvaluatorsBlock,
    openOffender,
    openMappingsMissingRefusal,
  };
}

/** Where the offender opens, and where a mappings-missing refusal is fixed. */
function useOffenderActions({
  offender,
  openInherited,
  editExtra,
  testSuites,
  extras,
}: {
  offender: EvaluatorOffender | null;
  openInherited: (params: { suiteId: string; attachmentId: string }) => void;
  editExtra: ReturnType<typeof useEditExtra>;
  testSuites: readonly SuiteRow[];
  extras: EvaluatorAttachment[];
}) {
  const openOffender = useCallback(() => {
    if (!offender) return;
    if (offender.kind === "suite") {
      openInherited({
        suiteId: offender.suiteId,
        attachmentId: offender.attachment.id,
      });
      return;
    }
    editExtra(offender.attachment);
  }, [offender, openInherited, editExtra]);

  const openMappingsMissingRefusal = useCallback(
    (error: unknown) => {
      const target = resolveMappingsMissingTarget({
        error,
        testSuites,
        extras,
      });
      if (!target) return;
      if (target.kind === "suite") {
        openInherited({
          suiteId: target.suiteId,
          attachmentId: target.attachmentId,
        });
        return;
      }
      editExtra(target.attachment);
    },
    [testSuites, extras, openInherited, editExtra],
  );

  return { openOffender, openMappingsMissingRefusal };
}

/** The dialog's own primitive hooks: routing, the project, and the drawer editors. */
function useRunEvaluatorsBase({ isOpen }: { isOpen: boolean }) {
  const router = useRouter();
  const { project } = useOrganizationTeamProject();
  const utils = api.useUtils();
  const { openDrawer, closeDrawer, goBack } = useDrawer();
  const openEvaluatorEditor = useOpenScenarioEvaluatorEditor();
  const openSuiteEditor = useOpenSuiteEditor();
  const { evaluatorsById } = useProjectEvaluators({ enabled: isOpen });
  return {
    router,
    projectId: project?.id ?? "",
    utils,
    openDrawer,
    closeDrawer,
    goBack,
    openEvaluatorEditor,
    openSuiteEditor,
    evaluatorsById,
  };
}

export type RunEvaluatorsInput = {
  scope: RunScope;
  scopedScenarioIds: readonly string[];
  scopeScenarios: readonly ScopeScenario[];
  testSuites: readonly SuiteRow[];
  extras: EvaluatorAttachment[];
  setExtras: (
    change: (extras: EvaluatorAttachment[]) => EvaluatorAttachment[],
  ) => void;
  showExtras: boolean;
  setShowExtras: (show: boolean) => void;
  /** Whether the dialog is open, which is when the evaluators are read. */
  isOpen: boolean;
};

export function useRunEvaluators({
  scope,
  scopedScenarioIds,
  scopeScenarios,
  testSuites,
  extras,
  setExtras,
  showExtras,
  setShowExtras,
  isOpen,
}: RunEvaluatorsInput) {
  const {
    router,
    projectId,
    utils,
    openDrawer,
    closeDrawer,
    goBack,
    openEvaluatorEditor,
    openSuiteEditor,
    evaluatorsById,
  } = useRunEvaluatorsBase({ isOpen });

  const { inherited, missingOf, offender } = useInheritedEvaluators({
    scope,
    scopedScenarioIds,
    scopeScenarios,
    testSuites,
    evaluatorsById,
    extras,
  });

  const {
    openInherited,
    editExtra,
    addExtra,
    showEvaluatorsBlock,
    removeEvaluatorsBlock,
    openOffender,
    openMappingsMissingRefusal,
  } = useRunEvaluatorsActions({
    inherited,
    extras,
    setExtras,
    evaluatorsById,
    openEvaluatorEditor,
    openSuiteEditor,
    goBack,
    offender,
    testSuites,
    openDrawer,
    closeDrawer,
    utils,
    projectId,
    setShowExtras,
  });

  const hasInherited = inherited.length > 0;

  return {
    inherited,
    extras,
    evaluatorsById,
    missingOf,
    hasInherited,
    /** The block stands while a suite in scope holds it, or once it was asked for. */
    showEvaluatorsSection: hasInherited || showExtras,
    showEvaluatorsBlock,
    removeEvaluatorsBlock,
    openInherited,
    editExtra,
    addExtra,
    offender,
    openOffender,
    openMappingsMissingRefusal,
    /** True while the list or an editor of the evaluator flow is open over the dialog. */
    isEvaluatorFlowOpen: isEvaluatorFlowDrawer(router.query["drawer.open"]),
  };
}

export type RunEvaluators = ReturnType<typeof useRunEvaluators>;
