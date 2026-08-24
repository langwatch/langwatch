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

import {
  Badge,
  Box,
  Button,
  EmptyState,
  HStack,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import { format } from "date-fns";
import { FlaskConical, FolderCode, Play, Plus } from "lucide-react";
import { LabelFilterDropdown } from "~/components/scenarios/LabelFilterDropdown";
import { RunMetricsSummary } from "~/components/suites/RunMetricsSummary";
import type { AgentTestingSelection } from "../useAgentTestingRouting";
import {
  type CaseLastResult,
  CasesTable,
  CasesTableSkeleton,
  ExternalCasesTable,
} from "./CasesTable";
import {
  type CaseGroup,
  lastRunAtOf,
  summaryFromLastResults,
  type TestCase,
  type TestSuiteEntry,
} from "./test-cases";

/** What the line under the table reads for the All test cases view. */
export const ALL_CASES_LAST_RUN_LABEL = "Last full run at";
/** What it reads for one test suite. */
export const SUITE_LAST_RUN_LABEL = "Last run on";

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
  authorNameById: Record<string, string>;
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
};

export function CasesPanel(props: CasesPanelProps) {
  const {
    selection,
    title,
    groups,
    externalCases,
    isLoading,
    lastResults,
    canManage,
    projectHasNoCases,
    allLabels,
    activeLabels,
    onToggleLabel,
    isRunningSet,
    onRunSet,
    onNewTestCase,
  } = props;

  const isExternal = selection.kind === "external";
  const caseCount = isExternal
    ? externalCases.length
    : groups.reduce((total, group) => total + group.cases.length, 0);

  return (
    <VStack
      align="stretch"
      gap={3}
      width="full"
      height="full"
      overflow="auto"
      padding={6}
      data-testid="agent-testing-cases-panel"
    >
      <HStack gap={2}>
        {isExternal && (
          <FolderCode size={16} color="var(--chakra-colors-fg-muted)" />
        )}
        <Text fontSize="sm" fontWeight="semibold">
          {title}
        </Text>
        <Text fontSize="xs" color="fg.muted">
          {caseCount === 1 ? "1 test case" : `${caseCount} test cases`}
        </Text>
        {isExternal && (
          <Badge size="xs" variant="subtle" colorPalette="gray">
            from code
          </Badge>
        )}
        <Spacer />
        {!isExternal && allLabels.length > 0 && (
          <LabelFilterDropdown
            allLabels={allLabels}
            activeLabels={activeLabels}
            onToggle={onToggleLabel}
          />
        )}
        {!isExternal && canManage && (
          <>
            <Button size="sm" variant="outline" onClick={onNewTestCase}>
              <Plus size={14} />
              New test case
            </Button>
            <Button
              size="sm"
              colorPalette="blue"
              loading={isRunningSet}
              onClick={onRunSet}
            >
              <Play size={14} />
              {selection.kind === "all" ? "Run all" : "Run suite"}
            </Button>
          </>
        )}
      </HStack>

      {isLoading ? (
        <CasesTableSkeleton />
      ) : isExternal ? (
        externalCases.length === 0 ? (
          <ExternalSetEmptyState />
        ) : (
          <ExternalCasesTable
            cases={externalCases}
            onRowClick={props.onOpenExternalCase}
          />
        )
      ) : caseCount === 0 ? (
        projectHasNoCases ? (
          <FirstCaseEmptyState
            canManage={canManage}
            onNewTestCase={onNewTestCase}
          />
        ) : (
          <NoCasesHereEmptyState
            canManage={canManage}
            onNewTestCase={onNewTestCase}
          />
        )
      ) : (
        <>
          <CasesTable
            groups={groups}
            showGroupHeadings={selection.kind === "all"}
            lastResults={lastResults}
            isLastResultsLoading={props.isLastResultsLoading}
            authorNameById={props.authorNameById}
            suites={props.suites}
            canManage={canManage}
            runningCaseId={props.runningCaseId}
            onSelectSuite={props.onSelectSuite}
            onRowClick={props.onRowClick}
            onRunCase={props.onRunCase}
            onEdit={props.onEdit}
            onHistory={props.onHistory}
            onDuplicate={props.onDuplicate}
            onMoveToSuite={props.onMoveToSuite}
            onOpenLastRun={props.onOpenLastRun}
            onArchive={props.onArchive}
          />
          <LastRunLine
            selection={selection}
            groups={groups}
            lastResults={lastResults}
          />
        </>
      )}
    </VStack>
  );
}

/**
 * The borderless line under the table: when the whole set last ran, and how
 * it did on the far right.
 */
function LastRunLine({
  selection,
  groups,
  lastResults,
}: {
  selection: AgentTestingSelection;
  groups: CaseGroup[];
  lastResults: Map<string, CaseLastResult>;
}) {
  const results = groups
    .flatMap((group) => group.cases)
    .map((testCase) => lastResults.get(testCase.id))
    .filter((result): result is CaseLastResult => !!result);

  if (results.length === 0) return null;

  const lastRunAt = lastRunAtOf(results);
  const label =
    selection.kind === "all" ? ALL_CASES_LAST_RUN_LABEL : SUITE_LAST_RUN_LABEL;

  return (
    <HStack gap={2} paddingX={1} data-testid="cases-last-run-line">
      <Text fontSize="xs" color="fg.muted">
        {label} {lastRunAt ? format(lastRunAt, "MMM d, HH:mm") : "-"}
      </Text>
      <Spacer />
      <RunMetricsSummary summary={summaryFromLastResults(results)} />
    </HStack>
  );
}

/**
 * What a project with no test case at all reads. It says what a test case is
 * before it asks for one.
 */
function FirstCaseEmptyState({
  canManage,
  onNewTestCase,
}: {
  canManage: boolean;
  onNewTestCase: () => void;
}) {
  return (
    <EmptyState.Root paddingY={12} data-testid="agent-testing-first-case-empty">
      <EmptyState.Content>
        <EmptyState.Indicator>
          <FlaskConical size={28} />
        </EmptyState.Indicator>
        <EmptyState.Title>Write your first test case</EmptyState.Title>
        <EmptyState.Description>
          A test case is one situation you put your agent in, with the criteria
          it must meet. LangWatch plays the situation against your agent and a
          judge says whether each criterion was met.
        </EmptyState.Description>
        {canManage && (
          <Box paddingTop={2}>
            <Button size="sm" colorPalette="blue" onClick={onNewTestCase}>
              <Plus size={14} />
              New test case
            </Button>
          </Box>
        )}
      </EmptyState.Content>
    </EmptyState.Root>
  );
}

/** What a test suite that holds nothing yet reads. */
function NoCasesHereEmptyState({
  canManage,
  onNewTestCase,
}: {
  canManage: boolean;
  onNewTestCase: () => void;
}) {
  return (
    <EmptyState.Root paddingY={12} data-testid="agent-testing-empty-suite">
      <EmptyState.Content>
        <EmptyState.Indicator>
          <FlaskConical size={28} />
        </EmptyState.Indicator>
        <EmptyState.Title>No test cases here</EmptyState.Title>
        <EmptyState.Description>
          Add a test case to this suite, or move one into it from another suite.
        </EmptyState.Description>
        {canManage && (
          <Box paddingTop={2}>
            <Button size="sm" variant="outline" onClick={onNewTestCase}>
              <Plus size={14} />
              New test case
            </Button>
          </Box>
        )}
      </EmptyState.Content>
    </EmptyState.Root>
  );
}

/** What a set that runs from code reads before its first run lands. */
function ExternalSetEmptyState() {
  return (
    <EmptyState.Root paddingY={12} data-testid="agent-testing-empty-external">
      <EmptyState.Content>
        <EmptyState.Indicator>
          <FolderCode size={28} />
        </EmptyState.Indicator>
        <EmptyState.Title>No runs in this period</EmptyState.Title>
        <EmptyState.Description>
          This set is written by code. Run it from the SDK or the command line,
          or widen the period.
        </EmptyState.Description>
      </EmptyState.Content>
    </EmptyState.Root>
  );
}
