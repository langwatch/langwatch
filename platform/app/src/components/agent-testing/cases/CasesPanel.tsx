/**
 * The right half of the Scenarios tab: the suite that is open, the cases in
 * it, and the way into a recent run of it.
 *
 * The panel is a view over what it is given, so the reads and the writes stay
 * in TestCasesTab and every rule here can be read on its own.
 *
 * @see specs/features/agent-testing/cases-table.feature
 * @see specs/features/agent-testing/page-structure.feature
 */

import type { Period } from "~/components/PeriodSelector";
import { CONTENT_COLUMN_GUTTER, ContentColumn } from "../shared/ContentColumn";
import type { AgentTestingSelection } from "../useAgentTestingRouting";
import { CasesPanelBody } from "./CasesPanelBody";
import { CasesPanelHeader } from "./CasesPanelHeader";
import type { CaseLastResult } from "./CasesTable";
import { SUITE_RAIL_WIDTH } from "./SuiteRail";
import type { TestCase, TestSuiteEntry } from "./test-cases";

export type ExternalCaseRow = {
  scenarioId: string;
  name: string;
  lastRunAt: number;
};

export type CasesPanelProps = {
  selection: AgentTestingSelection;
  /** The name of the open suite or set, as the header reads it. */
  title: string;
  /** The scenarios of the open suite, in order. */
  cases: TestCase[];
  /** The cases of an external set, when one is selected. */
  externalCases: ExternalCaseRow[];
  isLoading: boolean;
  lastResults: Map<string, CaseLastResult>;
  isLastResultsLoading: boolean;
  suites: TestSuiteEntry[];
  canManage: boolean;
  /** The open test suite, or nothing while the project holds none, which is day zero. */
  suite: TestSuiteEntry | null;
  /** True when the open suite ran at least once inside the period. */
  suiteHasRun: boolean;
  /** The window the runs of the suite are read in. */
  period: Period;
  /** False while the project has no agent to test, which comes before a suite. */
  hasAgent: boolean;
  /** True when the whole project holds no scenario at all. */
  projectHasNoCases: boolean;
  allLabels: string[];
  activeLabels: string[];
  onToggleLabel: (label: string) => void;
  runningCaseId?: string | null;
  isRunningSet?: boolean;
  onRunSet: () => void;
  onNewTestCase: () => void;
  /** Asks for the name of a new test suite. */
  onNewSuite: () => void;
  /** Opens the flow that connects the agent to be tested. */
  onConnectAgent: () => void;
  onRowClick: (testCase: TestCase) => void;
  onRunCase: (testCase: TestCase) => void;
  onEdit: (testCase: TestCase) => void;
  onHistory: (testCase: TestCase) => void;
  onDuplicate: (testCase: TestCase) => void;
  onMoveToSuite: (testCase: TestCase, suiteId: string) => void;
  onOpenLastRun: (testCase: TestCase) => void;
  onArchive: (testCase: TestCase) => void;
  onOpenExternalCase: (scenarioId: string) => void;
  /** Opens the name dialog on the open test suite. */
  onRenameSuite: () => void;
  /** Opens the results of the selected set that runs from code. */
  onOpenExternalResults: () => void;
};

export function CasesPanel(props: CasesPanelProps) {
  const isExternal = props.selection.kind === "external";
  const caseCount = isExternal
    ? props.externalCases.length
    : props.cases.length;

  return (
    <ContentColumn
      railWidth={SUITE_RAIL_WIDTH + CONTENT_COLUMN_GUTTER}
      data-testid="agent-testing-cases-panel"
    >
      <CasesPanelHeader
        {...props}
        isExternal={isExternal}
        caseCount={caseCount}
      />
      <CasesPanelBody {...props} isExternal={isExternal} />
    </ContentColumn>
  );
}
