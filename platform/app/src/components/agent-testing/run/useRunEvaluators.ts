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

import { useCallback } from "react";
import { useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { EvaluatorAttachment } from "~/server/scenarios/evaluator-attachments";
import { api } from "~/utils/api";
import { useRouter } from "~/utils/compat/next-router";
import { useOpenScenarioEvaluatorEditor } from "../evaluators/useOpenScenarioEvaluatorEditor";
import { useProjectEvaluators } from "../evaluators/useProjectEvaluators";
import { useOpenSuiteEditor } from "../suite/useOpenSuiteEditor";
import type { ScopeScenario } from "./RunScopeSection";
import type { RunScope } from "./run-configuration";
import { isEvaluatorFlowDrawer, type SuiteRow } from "./run-evaluators";
import { useExtraEvaluatorsFlow } from "./useEditAndAttachExtra";
import {
  useInheritedEvaluators,
  useOffenderActions,
} from "./useEvaluatorOffenders";

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
  setShowExtras: (isShown: boolean) => void;
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

  const openInherited = useCallback(
    ({ suiteId, attachmentId }: { suiteId: string; attachmentId: string }) =>
      openSuiteEditor({ testSuiteId: suiteId, attachmentId }),
    [openSuiteEditor],
  );

  const { editExtra, addExtra, showEvaluatorsBlock, removeEvaluatorsBlock } =
    useExtraEvaluatorsFlow({
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
    });

  const { openOffender, openMappingsMissingRefusal } = useOffenderActions({
    offender,
    openInherited,
    editExtra,
    testSuites,
    extras,
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
