/**
 * The table of test cases: the name, the labels, the last result and who
 * added the case, with a Run button and a row menu at the end of every row.
 *
 * In All test cases the rows sit under their test suite, unfiled cases last.
 * Under one suite the rows are flat.
 *
 * @see specs/features/agent-testing/cases-table.feature
 * @see specs/scenarios/scenario-folder-assignment.feature
 */

import {
  Box,
  Button,
  HStack,
  Skeleton,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import { format } from "date-fns";
import { MoreVertical } from "lucide-react";
import type { TargetValue } from "~/components/scenarios/TargetSelector";
import { RunMetricsSummary } from "~/components/suites/RunMetricsSummary";
import { ListTable } from "~/components/ui/ListTable";
import { Menu } from "~/components/ui/menu";
import { TagList } from "~/components/ui/TagList";
import { Tooltip } from "~/components/ui/tooltip";
import type { ScenarioLastResultSummary } from "~/server/scenarios/scenario-event.types";
import { FolderHeaderRow } from "../shared/FolderHeaderRow";
import { LastResultLabel } from "../shared/LastResultLabel";
import { ResultMetricsInline } from "../shared/ResultMetricsInline";
import { RunCaseButton } from "./RunCaseButton";
import {
  type CaseGroup,
  criteriaOf,
  summaryFromLastResults,
  type TestCase,
  type TestSuiteEntry,
  UNFILED_GROUP_ID,
} from "./test-cases";

/**
 * The last result of a case. The duration and the cost are read from the run
 * when the summary carries them; the aggregate answers with the verdict alone
 * today, so a cell without them reads the verdict.
 */
export type CaseLastResult = ScenarioLastResultSummary & {
  durationInMs?: number | null;
  totalCost?: number | null;
};

const COLUMN_COUNT = 4;

export type CasesTableProps = {
  groups: CaseGroup[];
  /** True in All test cases, where each suite heads its own rows. */
  showGroupHeadings: boolean;
  lastResults: Map<string, CaseLastResult>;
  /** True while the last-result cells are still on their way. */
  isLastResultsLoading: boolean;
  /** The name of the person who last saved each case, when it is known. */
  authorNameById: Record<string, string>;
  /** The test suites a case can be moved into. */
  suites: TestSuiteEntry[];
  canManage: boolean;
  /** The agent each case last ran against, so the Run dialog opens on it. */
  targetOf: (caseId: string) => TargetValue;
  runningCaseId?: string | null;
  onSelectSuite: (suiteId: string) => void;
  onRowClick: (testCase: TestCase) => void;
  onRun: (testCase: TestCase, target: TargetValue) => void;
  onEdit: (testCase: TestCase) => void;
  onDuplicate: (testCase: TestCase) => void;
  onMoveToSuite: (testCase: TestCase, suiteId: string | null) => void;
  onOpenLastRun: (testCase: TestCase) => void;
  onArchive: (testCase: TestCase) => void;
};

export function CasesTable({
  groups,
  showGroupHeadings,
  lastResults,
  isLastResultsLoading,
  authorNameById,
  suites,
  canManage,
  targetOf,
  runningCaseId,
  onSelectSuite,
  onRowClick,
  onRun,
  onEdit,
  onDuplicate,
  onMoveToSuite,
  onOpenLastRun,
  onArchive,
}: CasesTableProps) {
  return (
    <ListTable size="sm" data-testid="agent-testing-cases-table">
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeader>Test case</Table.ColumnHeader>
          <Table.ColumnHeader width="220px">Last result</Table.ColumnHeader>
          <Table.ColumnHeader width="180px">Added</Table.ColumnHeader>
          <Table.ColumnHeader width="130px" />
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {groups.map((group) => (
          <CaseGroupRows
            key={group.id}
            group={group}
            showGroupHeading={showGroupHeadings}
            lastResults={lastResults}
            isLastResultsLoading={isLastResultsLoading}
            authorNameById={authorNameById}
            suites={suites}
            canManage={canManage}
            targetOf={targetOf}
            runningCaseId={runningCaseId}
            onSelectSuite={onSelectSuite}
            onRowClick={onRowClick}
            onRun={onRun}
            onEdit={onEdit}
            onDuplicate={onDuplicate}
            onMoveToSuite={onMoveToSuite}
            onOpenLastRun={onOpenLastRun}
            onArchive={onArchive}
          />
        ))}
      </Table.Body>
    </ListTable>
  );
}

type GroupRowsProps = Omit<CasesTableProps, "groups" | "showGroupHeadings"> & {
  group: CaseGroup;
  showGroupHeading: boolean;
};

function CaseGroupRows({
  group,
  showGroupHeading,
  lastResults,
  isLastResultsLoading,
  authorNameById,
  suites,
  canManage,
  targetOf,
  runningCaseId,
  onSelectSuite,
  onRowClick,
  onRun,
  onEdit,
  onDuplicate,
  onMoveToSuite,
  onOpenLastRun,
  onArchive,
}: GroupRowsProps) {
  const groupResults = group.cases
    .map((testCase) => lastResults.get(testCase.id))
    .filter((result): result is CaseLastResult => !!result);

  return (
    <>
      {showGroupHeading && (
        <FolderHeaderRow
          name={group.name}
          caseCount={group.cases.length}
          colSpan={COLUMN_COUNT}
          onClick={
            group.id === UNFILED_GROUP_ID
              ? undefined
              : () => onSelectSuite(group.id)
          }
        >
          {groupResults.length > 0 && (
            <RunMetricsSummary summary={summaryFromLastResults(groupResults)} />
          )}
        </FolderHeaderRow>
      )}
      {group.cases.map((testCase) => (
        <CaseRow
          key={testCase.id}
          testCase={testCase}
          lastResult={lastResults.get(testCase.id)}
          isLastResultsLoading={isLastResultsLoading}
          showMetricsInline={!showGroupHeading}
          authorName={
            testCase.lastUpdatedById
              ? authorNameById[testCase.lastUpdatedById]
              : undefined
          }
          suites={suites}
          canManage={canManage}
          target={targetOf(testCase.id)}
          isRunning={runningCaseId === testCase.id}
          onRowClick={onRowClick}
          onRun={onRun}
          onEdit={onEdit}
          onDuplicate={onDuplicate}
          onMoveToSuite={onMoveToSuite}
          onOpenLastRun={onOpenLastRun}
          onArchive={onArchive}
        />
      ))}
    </>
  );
}

function CaseRow({
  testCase,
  lastResult,
  isLastResultsLoading,
  showMetricsInline,
  authorName,
  suites,
  canManage,
  target,
  isRunning,
  onRowClick,
  onRun,
  onEdit,
  onDuplicate,
  onMoveToSuite,
  onOpenLastRun,
  onArchive,
}: {
  testCase: TestCase;
  lastResult?: CaseLastResult;
  isLastResultsLoading: boolean;
  showMetricsInline: boolean;
  authorName?: string;
  suites: TestSuiteEntry[];
  canManage: boolean;
  target: TargetValue;
  isRunning: boolean;
  onRowClick: (testCase: TestCase) => void;
  onRun: (testCase: TestCase, target: TargetValue) => void;
  onEdit: (testCase: TestCase) => void;
  onDuplicate: (testCase: TestCase) => void;
  onMoveToSuite: (testCase: TestCase, suiteId: string | null) => void;
  onOpenLastRun: (testCase: TestCase) => void;
  onArchive: (testCase: TestCase) => void;
}) {
  return (
    <Table.Row
      cursor="pointer"
      _hover={{ background: "bg.muted" }}
      onClick={() => onRowClick(testCase)}
      data-testid={`case-row-${testCase.name}`}
    >
      <Table.Cell>
        <HStack gap={2} minWidth={0}>
          <Text fontSize="sm" fontWeight="medium" truncate>
            {testCase.name}
          </Text>
          <TagList labels={testCase.labels} tone="pastel" />
        </HStack>
      </Table.Cell>
      <Table.Cell>
        <LastResultCell
          lastResult={lastResult}
          isLoading={isLastResultsLoading}
          showMetricsInline={showMetricsInline}
        />
      </Table.Cell>
      <Table.Cell>
        <Text fontSize="xs" color="fg.muted" whiteSpace="nowrap" truncate>
          {authorName ? `${authorName} · ` : ""}
          {format(testCase.createdAt, "MMM d")}
        </Text>
      </Table.Cell>
      <Table.Cell>
        <HStack gap={1} justify="flex-end">
          {canManage && (
            <RunCaseButton
              caseName={testCase.name}
              initialTarget={target}
              isRunning={isRunning}
              onRun={(chosen) => onRun(testCase, chosen)}
            />
          )}
          <CaseRowActionsMenu
            testCase={testCase}
            suites={suites}
            canManage={canManage}
            hasLastRun={!!lastResult}
            onEdit={onEdit}
            onDuplicate={onDuplicate}
            onMoveToSuite={onMoveToSuite}
            onOpenLastRun={onOpenLastRun}
            onArchive={onArchive}
          />
        </HStack>
      </Table.Cell>
    </Table.Row>
  );
}

/**
 * What the last run of a case said. Empty while the results are on their way,
 * so the rows are drawn before the verdicts arrive.
 *
 * Under one test suite the time and the cost read beside the verdict. In All
 * test cases the column is narrower, so they read on hover instead.
 */
function LastResultCell({
  lastResult,
  isLoading,
  showMetricsInline,
}: {
  lastResult?: CaseLastResult;
  isLoading: boolean;
  showMetricsInline: boolean;
}) {
  if (!lastResult) {
    if (isLoading) return <Skeleton height="16px" width="90px" />;
    return <Box data-testid="last-result-empty" />;
  }

  const label = (
    <LastResultLabel
      status={lastResult.status}
      results={criteriaOf(lastResult)}
    />
  );
  const metrics = (
    <ResultMetricsInline
      durationInMs={lastResult.durationInMs}
      totalCost={lastResult.totalCost}
    />
  );
  const hasMetrics =
    typeof lastResult.durationInMs === "number" ||
    typeof lastResult.totalCost === "number";

  if (showMetricsInline) {
    return (
      <HStack gap={2} minWidth={0}>
        {label}
        {metrics}
      </HStack>
    );
  }

  return (
    <Tooltip content={metrics} disabled={!hasMetrics}>
      <HStack gap={2} minWidth={0}>
        {label}
      </HStack>
    </Tooltip>
  );
}

function CaseRowActionsMenu({
  testCase,
  suites,
  canManage,
  hasLastRun,
  onEdit,
  onDuplicate,
  onMoveToSuite,
  onOpenLastRun,
  onArchive,
}: {
  testCase: TestCase;
  suites: TestSuiteEntry[];
  canManage: boolean;
  hasLastRun: boolean;
  onEdit: (testCase: TestCase) => void;
  onDuplicate: (testCase: TestCase) => void;
  onMoveToSuite: (testCase: TestCase, suiteId: string | null) => void;
  onOpenLastRun: (testCase: TestCase) => void;
  onArchive: (testCase: TestCase) => void;
}) {
  const stop = (event: React.MouseEvent) => event.stopPropagation();

  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <Button
          size="xs"
          variant="ghost"
          aria-label={`Actions for ${testCase.name}`}
          onClick={stop}
        >
          <MoreVertical size={14} />
        </Button>
      </Menu.Trigger>
      <Menu.Content>
        {canManage && (
          <Menu.Item
            value="edit"
            onClick={(event) => {
              stop(event);
              onEdit(testCase);
            }}
          >
            Edit
          </Menu.Item>
        )}
        {canManage && (
          <Menu.Item
            value="duplicate"
            onClick={(event) => {
              stop(event);
              onDuplicate(testCase);
            }}
          >
            Duplicate
          </Menu.Item>
        )}
        {canManage && (
          <Menu.Root positioning={{ placement: "right-start", gutter: 2 }}>
            <Menu.TriggerItem value="move-to-suite">
              Move to suite
            </Menu.TriggerItem>
            <Menu.Content>
              {suites.map((suite) => (
                <Menu.Item
                  key={suite.id}
                  value={`move-${suite.id}`}
                  onClick={(event) => {
                    stop(event);
                    onMoveToSuite(testCase, suite.id);
                  }}
                >
                  {suite.name}
                </Menu.Item>
              ))}
              <Menu.Item
                value="move-unfiled"
                onClick={(event) => {
                  stop(event);
                  onMoveToSuite(testCase, null);
                }}
              >
                No test suite
              </Menu.Item>
            </Menu.Content>
          </Menu.Root>
        )}
        {hasLastRun && (
          <Menu.Item
            value="open-last-run"
            onClick={(event) => {
              stop(event);
              onOpenLastRun(testCase);
            }}
          >
            Open last run
          </Menu.Item>
        )}
        {canManage && (
          <Menu.Item
            value="archive"
            color="orange.500"
            onClick={(event) => {
              stop(event);
              onArchive(testCase);
            }}
          >
            Archive
          </Menu.Item>
        )}
      </Menu.Content>
    </Menu.Root>
  );
}

/** The rows of a set that runs from code: names and last run times, nothing to change. */
export function ExternalCasesTable({
  cases,
  onRowClick,
}: {
  cases: { scenarioId: string; name: string; lastRunAt: number }[];
  onRowClick: (scenarioId: string) => void;
}) {
  return (
    <ListTable size="sm" data-testid="agent-testing-external-cases-table">
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeader>Test case</Table.ColumnHeader>
          <Table.ColumnHeader width="220px">Last run</Table.ColumnHeader>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {cases.map((externalCase) => (
          <Table.Row
            key={externalCase.scenarioId}
            cursor="pointer"
            _hover={{ background: "bg.muted" }}
            onClick={() => onRowClick(externalCase.scenarioId)}
            data-testid={`external-case-row-${externalCase.name}`}
          >
            <Table.Cell>
              <Text fontSize="sm" fontWeight="medium" truncate>
                {externalCase.name}
              </Text>
            </Table.Cell>
            <Table.Cell>
              <Text fontSize="xs" color="fg.muted" whiteSpace="nowrap">
                {format(externalCase.lastRunAt, "MMM d, HH:mm")}
              </Text>
            </Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </ListTable>
  );
}

/** The skeleton the table stands in as while the case list is read. */
export function CasesTableSkeleton() {
  return (
    <VStack align="stretch" gap={2} data-testid="agent-testing-cases-skeleton">
      <Skeleton height="44px" />
      <Skeleton height="44px" />
      <Skeleton height="44px" />
    </VStack>
  );
}
