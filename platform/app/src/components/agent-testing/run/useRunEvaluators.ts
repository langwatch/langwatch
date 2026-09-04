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
  const router = useRouter();
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id ?? "";
  const utils = api.useUtils();
  const { openDrawer, closeDrawer, goBack } = useDrawer();
  const openEvaluatorEditor = useOpenScenarioEvaluatorEditor();
  const openSuiteEditor = useOpenSuiteEditor();
  const { evaluatorsById } = useProjectEvaluators({ enabled: isOpen });

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

  const openInherited = useCallback(
    ({ suiteId, attachmentId }: { suiteId: string; attachmentId: string }) =>
      openSuiteEditor({ testSuiteId: suiteId, attachmentId }),
    [openSuiteEditor],
  );

  /**
   * Opens the editor on one of the plan's own attachments. An evaluator just
   * created is handed in, since the list has not read it back yet.
   */
  const editExtra = useCallback(
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
      const navigation = options?.navigation;
      const attachmentId = attachment.id;
      openEvaluatorEditor({
        attachment,
        evaluator,
        ctx: PLAN_CTX,
        planLevel: true,
        navigation,
        onMappingChange: (
          input: string,
          mapping: ScenarioMapping | undefined,
        ) =>
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
      });
    },
    [evaluatorsById, openEvaluatorEditor, setExtras, goBack],
  );

  /**
   * What a pick does: an evaluator a suite in scope carries is edited there,
   * one the plan already has opens its editor, and a new one is attached
   * with the conversation and the trace inferred.
   */
  const attach = useCallback(
    (evaluator: EvaluatorWithFields) => {
      const fromSuite = inherited
        .flatMap((suite) =>
          suite.attachments.map((attachment) => ({ suite, attachment })),
        )
        .find(({ attachment }) => attachment.evaluatorId === evaluator.id);
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

  /** Opens the list, without the evaluators a run plan cannot feed. */
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
    const hiddenEvaluatorIds = [...evaluatorsById.values()]
      .filter((evaluator) => !evaluatorFitsPlanLevel(evaluator))
      .map((evaluator) => evaluator.id);
    openDrawer("evaluatorList", { hiddenEvaluatorIds });
  }, [attach, evaluatorsById, openDrawer, closeDrawer, utils, projectId]);

  const showEvaluatorsBlock = useCallback(() => {
    setShowExtras(true);
    addExtra();
  }, [setShowExtras, addExtra]);

  const removeEvaluatorsBlock = useCallback(() => {
    setShowExtras(false);
    setExtras(() => []);
  }, [setShowExtras, setExtras]);

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

  /**
   * Where a refusal the server named is fixed: the suite that attaches the
   * evaluator, or the plan's own attachment.
   */
  const openMappingsMissingRefusal = useCallback(
    (error: unknown) => {
      const handled = readHandledError(error);
      if (handled?.code !== "suite_evaluator_mappings_missing") return;
      const { suiteId, evaluatorId } = handled.meta;
      if (typeof evaluatorId !== "string") return;
      const suite = testSuites.find((row) => row.id === suiteId);
      const attachment = suite
        ? parseEvaluatorAttachments(suite.evaluators).find(
            (entry) => entry.evaluatorId === evaluatorId,
          )
        : undefined;
      if (suite && attachment) {
        openInherited({ suiteId: suite.id, attachmentId: attachment.id });
        return;
      }
      const extra = extras.find((entry) => entry.evaluatorId === evaluatorId);
      if (extra) editExtra(extra);
    },
    [testSuites, extras, openInherited, editExtra],
  );

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
