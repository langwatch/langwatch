/**
 * The right half of the Scenarios tab: the suite that is open, the scenarios in
 * it, and the way into a recent run of it.
 *
 * The panel is a view over what it is given, so the reads and the writes stay
 * in TestCasesTab and every rule here can be read on its own.
 *
 * @see specs/features/agent-testing/cases-table.feature
 * @see specs/features/agent-testing/page-structure.feature
 */

import type { Period } from "@langwatch/analytics-web/components/PeriodSelector";
import {
  CONTENT_COLUMN_GUTTER,
  ContentColumn,
} from "../../../elements/agent-testing/shared/content-column";
import type { AgentTestingSelection } from "../../../../behavior/agent-testing/use-agent-testing-routing";
import { CasesPanelBody } from "./cases-panel-body";
import { CasesPanelHeader } from "./cases-panel-header";
import type { CaseLastResult } from "../../../elements/agent-testing/cases/cases-table";
import { SUITE_RAIL_WIDTH } from "./suite-rail";
import type { TestCase, TestSuiteEntry } from "../../../../model/agent-testing/cases/test-cases";

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
  /** The scenarios of an external set, when one is selected. */
  externalCases: ExternalCaseRow[];
  isLoading: boolean;
  lastResults: Map<string, CaseLastResult>;
  isLastResultsLoading: boolean;
  suites: TestSuiteEntry[];
  canManage: boolean;
  /** The open test suite, or nothing while the project holds none, which is day zero. */
  suite: TestSuiteEntry | null;
  /**
   * Every scenario filed under the open suite, whatever the label filter
   * shows. The recent runs under the table are the runs that covered one of
   * them, so they are read from the suite and not from the rows on screen.
   */
  suiteScenarioIds: string[];
  /** The window the runs of the suite are read in. */
  period: Period;
  /** False while the project has no agent to test, which comes before a suite. */
  hasAgent: boolean;
  /** True when the whole project holds no scenario at all. */
  projectHasNoCases: boolean;
  allLabels: string[];
  activeLabels: string[];
  onToggleLabel: (label: string) => void;
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
  onDuplicate: (testCase: TestCase) => void;
  onMoveToSuite: (testCase: TestCase, suiteId: string) => void;
  onArchive: (testCase: TestCase) => void;
  onOpenExternalCase: (scenarioId: string) => void;
  /** Opens the name dialog on the open test suite. */
  onRenameSuite: () => void;
};

export function CasesPanel(props: CasesPanelProps) {
  const isExternal = props.selection.kind === "external";
  const caseCount = isExternal ? props.externalCases.length : props.cases.length;

  return (
    <ContentColumn
      railWidth={SUITE_RAIL_WIDTH + CONTENT_COLUMN_GUTTER}
      data-testid="agent-testing-cases-panel"
    >
      <CasesPanelHeader {...props} isExternal={isExternal} caseCount={caseCount} />
      <CasesPanelBody {...props} isExternal={isExternal} />
    </ContentColumn>
  );
}
