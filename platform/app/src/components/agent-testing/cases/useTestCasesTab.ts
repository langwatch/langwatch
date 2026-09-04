/**
 * Everything the Scenarios tab reads and writes, in one model.
 *
 * The rail, the panel and the dialogs are views over this model, so each of
 * them can be read on its own and none of them holds a query of its own.
 *
 * @see specs/features/agent-testing/suites-rail.feature
 * @see specs/features/agent-testing/cases-table.feature
 */

import { useCallback } from "react";
import type {
  Period,
  PeriodMode,
  RelativePresetKey,
} from "~/components/PeriodSelector";
import { usePeriodSelector } from "~/components/PeriodSelector";
import { useCan } from "~/hooks/useCan";
import { useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { AgentTestingSelection } from "../useAgentTestingRouting";
import { useAgentTestingRouting } from "../useAgentTestingRouting";
import { useAgentTestingStore } from "../useAgentTestingStore";
import { CASE_EDITOR_DRAWER } from "./AgentTestingCaseEditorDrawer";
import { AGENT_TYPE_SELECTOR_DRAWER } from "./drawerKeys";
import { type CaseOpenActions, useCaseOpenActions } from "./useCaseOpenActions";
import { type CaseRunActions, useCaseRunActions } from "./useCaseRunActions";
import {
  type SuiteNameDialogModel,
  useSuiteNameDialog,
} from "./useSuiteNameDialog";
import { type TestCasesData, useTestCasesData } from "./useTestCasesData";
import {
  type CaseMutations,
  type SuiteMutations,
  useCaseMutations,
  useSuiteMutations,
} from "./useTestCasesMutations";
import { type TestCasesView, useTestCasesView } from "./useTestCasesView";

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
  const onConnectAgent = useCallback(
    () => openDrawer(AGENT_TYPE_SELECTOR_DRAWER),
    [openDrawer],
  );

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
  const suiteDialog = useSuiteNameDialog({
    suites: data.suites,
    suiteMutations,
  });

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
