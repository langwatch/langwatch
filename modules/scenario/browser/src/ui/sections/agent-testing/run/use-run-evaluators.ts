/**
 * The evaluators of an open run dialog: inherited from suites in scope,
 * the plan's own extras, both editors, and the guard blocking Run when an
 * input still reads nothing. Extras reset with the subject; inherited ones are read-only.
 */

import { useDrawer } from "@langwatch/browser-host/drawer";
import { useRouter } from "@langwatch/browser-host/use-router";
import type { EvaluatorAttachment } from "@langwatch/scenario-contract";
import { useCallback } from "react";

import { useOpenScenarioEvaluatorEditor } from "../../../../behavior/agent-testing/evaluators/use-open-scenario-evaluator-editor.ts";
import { useProjectEvaluators } from "../../../../behavior/agent-testing/evaluators/use-project-evaluators.ts";
import { useOpenSuiteEditor } from "../../../../behavior/agent-testing/suite/use-open-suite-editor.ts";
import { api } from "../../../../behavior/scenario-api.ts";
import { useOrganizationTeamProject } from "../../../../behavior/use-organization-team-project.ts";
import type { RunScope } from "./run-configuration";
import { isEvaluatorFlowDrawer, type SuiteRow } from "./run-evaluators";
import type { ScopeScenario } from "./run-scope-section.tsx";
import { useExtraEvaluatorsFlow } from "./use-edit-and-attach-extra";
import { useInheritedEvaluators, useOffenderActions } from "./use-evaluator-offenders";

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
  setExtras: (change: (extras: EvaluatorAttachment[]) => EvaluatorAttachment[]) => void;
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
