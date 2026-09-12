/**
 * Everything the Scenarios tab reads and writes, in one model.
 * @see specs/features/agent-testing/suites-rail.feature
 * @see specs/features/agent-testing/cases-table.feature
 */

import { useCallback } from "react";
import type {
  Period,
  PeriodMode,
  RelativePresetKey,
} from "@langwatch/analytics-web/surfaces/period-selector";
import { usePeriodSelector } from "@langwatch/analytics-web/surfaces/period-selector";
import { useDrawer } from "@langwatch/ui-drawer";
// DANGLING: `useOpenSuiteEditor` / `OpenSuiteEditorParams` do not exist
// anywhere in this tree - part of the never-ported suite-editor surface
// (SuiteEditorDrawer, suiteEditorStore, SuiteEvaluatorsSection,
// evaluators/attachment-rules, useOpenScenarioEvaluatorEditor,
// useProjectEvaluators). See handoff merge-scenario-dangling-imports.
import {
  type OpenSuiteEditorParams,
  useOpenSuiteEditor,
} from "../../../../behavior/agent-testing/suite/use-open-suite-editor.ts";
import type { AgentTestingSelection } from "../../../../behavior/agent-testing/use-agent-testing-routing.ts";
import { useAgentTestingRouting } from "../../../../behavior/agent-testing/use-agent-testing-routing.ts";
import { useCan } from "../../../../behavior/use-can.ts";
import { useOrganizationTeamProject } from "../../../../behavior/use-organization-team-project.ts";
import { useAgentTestingStore } from "../use-agent-testing-store.ts";
import { CASE_EDITOR_DRAWER } from "./agent-testing-case-editor-drawer.tsx";
import { AGENT_TYPE_SELECTOR_DRAWER } from "./drawer-keys.ts";
import { type CaseOpenActions, useCaseOpenActions } from "./use-case-open-actions.ts";
import { type CaseRunActions, useCaseRunActions } from "./use-case-run-actions.ts";
import { type SuiteNameDialogModel, useSuiteNameDialog } from "./use-suite-name-dialog.ts";
import { type TestCasesData, useTestCasesData } from "./use-test-cases-data.ts";
import {
  type CaseMutations,
  type SuiteMutations,
  useCaseMutations,
  useSuiteMutations,
} from "../../../../behavior/agent-testing/cases/use-test-cases-mutations.ts";
import { type TestCasesView, useTestCasesView } from "./use-test-cases-view.ts";

export type PeriodPicker = {
  period: Period;
  mode: PeriodMode;
  setPeriod: (startDate: Date, endDate: Date) => void;
  setRelativePeriod: (key: RelativePresetKey) => void;
};

export type TestCasesTabBase = {
  projectId: string;
  canManage: boolean;
  selection: AgentTestingSelection;
  selectSuite: (selection: AgentTestingSelection) => void;
  selectPlan: (planSlug: string | null) => void;
  periodPicker: PeriodPicker;
  isRailCollapsed: boolean;
  toggleRail: () => void;
  /** Opens the create-a-scenario flow, filed in the suite it is given. */
  onNewTestCase: (testSuiteId: string | null) => void;
  /** Opens the flow that connects the agent to be tested. */
  onConnectAgent: () => void;
  /** Opens the suite editor on one suite, at one attachment when asked. */
  openSuiteEditor: (params: OpenSuiteEditorParams) => void;
};

function useTestCasesTabBase(): TestCasesTabBase {
  const { project } = useOrganizationTeamProject();
  const { can } = useCan();
  const { selection, selectSuite, selectPlan } = useAgentTestingRouting();
  const { period, mode, setPeriod, setRelativePeriod } = usePeriodSelector(30);
  const isRailCollapsed = useAgentTestingStore((state) => state.railCollapsed);
  const toggleRail = useAgentTestingStore((state) => state.toggleRailCollapsed);
  const { openDrawer } = useDrawer();
  const onNewTestCase = useCallback(
    (testSuiteId: string | null) =>
      openDrawer(CASE_EDITOR_DRAWER, { testSuiteId: testSuiteId ?? undefined }),
    [openDrawer],
  );
  const onConnectAgent = useCallback(() => openDrawer(AGENT_TYPE_SELECTOR_DRAWER), [openDrawer]);
  const openSuiteEditor = useOpenSuiteEditor();

  return {
    projectId: project?.id ?? "",
    canManage: can("scenarios:manage"),
    selection,
    selectSuite,
    selectPlan,
    periodPicker: { period, mode, setPeriod, setRelativePeriod },
    isRailCollapsed,
    toggleRail,
    onNewTestCase,
    onConnectAgent,
    openSuiteEditor,
  };
}

export type TestCasesTabModel = {
  base: TestCasesTabBase;
  data: TestCasesData;
  view: TestCasesView;
  suiteMutations: SuiteMutations;
  caseMutations: CaseMutations;
  suiteDialog: SuiteNameDialogModel;
  run: CaseRunActions;
  open: CaseOpenActions;
};

export function useTestCasesTab(): TestCasesTabModel {
  const base = useTestCasesTabBase();
  const { projectId, selection, selectSuite } = base;

  const data = useTestCasesData({ period: base.periodPicker.period });
  const view = useTestCasesView({
    selection,
    period: base.periodPicker.period,
    suites: data.suites,
    cases: data.cases,
  });

  const run = useCaseRunActions({
    projectId,
    cases: data.cases,
    selectedSuite: view.selectedSuite,
    suites: data.suites,
  });

  const suiteMutations = useSuiteMutations({
    projectId,
    selectedSuiteId: view.selectedSuite?.id ?? null,
    selectSuite,
  });
  const suiteDialog = useSuiteNameDialog({ suiteMutations });

  const caseMutations = useCaseMutations(projectId);
  const open = useCaseOpenActions();

  return {
    base,
    data,
    view,
    suiteMutations,
    caseMutations,
    suiteDialog,
    run,
    open,
  };
}
