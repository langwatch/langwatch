/**
 * The right half of the Test cases tab: what is selected, the cases in it,
 * and how the whole set last did.
 *
 * The panel is a view over what it is given, so the reads and the writes stay
 * in TestCasesTab and every rule here can be read on its own.
 *
 * @see specs/features/agent-testing/cases-table.feature
 * @see specs/features/agent-testing/page-structure.feature
 */

import { CONTENT_COLUMN_GUTTER, ContentColumn } from "../../../elements/agent-testing/shared/content-column";
import type { AgentTestingSelection } from "../../../../behavior/agent-testing/use-agent-testing-routing";
import { CasesPanelBody } from "./cases-panel-body";
import { CasesPanelHeader } from "./cases-panel-header";
import type { CaseLastResult } from "../../../elements/agent-testing/cases/cases-table";
import { SUITE_RAIL_WIDTH } from "./suite-rail";
import type { CaseGroup, TestCase, TestSuiteEntry } from "../../../../model/agent-testing/cases/test-cases";

export {
  ALL_CASES_LAST_RUN_LABEL,
  SUITE_LAST_RUN_LABEL,
} from "./last-run-line";

export type ExternalCaseRow = {
  scenarioId: string;
  name: string;
  lastRunAt: number;
};

export type CasesPanelProps = {
  selection: AgentTestingSelection;
  /** The name of the selected set, as the header reads it. */
  title: string;
  groups: CaseGroup[];
  /** The cases of an external set, when one is selected. */
  externalCases: ExternalCaseRow[];
  isLoading: boolean;
  lastResults: Map<string, CaseLastResult>;
  isLastResultsLoading: boolean;
  suites: TestSuiteEntry[];
  canManage: boolean;
  /** True when the whole project holds no test case at all. */
  projectHasNoCases: boolean;
  allLabels: string[];
  activeLabels: string[];
  onToggleLabel: (label: string) => void;
  runningCaseId?: string | null;
  isRunningSet?: boolean;
  onRunSet: () => void;
  onNewTestCase: () => void;
  onSelectSuite: (suiteId: string) => void;
  onRowClick: (testCase: TestCase) => void;
  onRunCase: (testCase: TestCase) => void;
  onEdit: (testCase: TestCase) => void;
  onHistory: (testCase: TestCase) => void;
  onDuplicate: (testCase: TestCase) => void;
  onMoveToSuite: (testCase: TestCase, suiteId: string | null) => void;
  onOpenLastRun: (testCase: TestCase) => void;
  onArchive: (testCase: TestCase) => void;
  onOpenExternalCase: (scenarioId: string) => void;
  /** Opens the editor of the selected test suite. */
  onEditSuite: () => void;
  /** Opens the results of the selected set that runs from code. */
  onOpenExternalResults: () => void;
};

export function CasesPanel(props: CasesPanelProps) {
  const isExternal = props.selection.kind === "external";
  const caseCount = isExternal
    ? props.externalCases.length
    : props.groups.reduce((total, group) => total + group.cases.length, 0);

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
      <CasesPanelBody
        {...props}
        isExternal={isExternal}
        caseCount={caseCount}
      />
    </ContentColumn>
  );
}
