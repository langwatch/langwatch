/**
 * The table of test cases: the name, the labels and the last result, with a
 * Run button and a row menu at the end of every row.
 *
 * The table is a grid inside one card, not a ruled table: the columns line up
 * without a vertical rule between them, so a long list of cases reads as a
 * list of names rather than as a spreadsheet.
 *
 * In All test cases the rows sit under their test suite, unfiled cases last.
 * Under one suite the rows are flat, and the time and the cost of the last run
 * read beside the verdict.
 *
 * @see specs/features/agent-testing/cases-table.feature
 * @see specs/scenarios/scenario-folder-assignment.feature
 */

import {
  Box,
  Button,
  HStack,
  Skeleton,
  Text,
  VStack,
} from "@chakra-ui/react";
import { format } from "date-fns";
import { MoreVertical } from "lucide-react";
import { RunMetricsSummary } from "~/components/suites/RunMetricsSummary";
import { Menu } from "~/components/ui/menu";
import { TagList } from "~/components/ui/TagList";
import { Tooltip } from "~/components/ui/tooltip";
import type { ScenarioLastResultSummary } from "~/server/scenarios/scenario-event.types";
import { FG_FAINT, ROW_HOVER_BG, TABLE_HEADER_BG } from "../shared/design";
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

/** The last result of a case, as the aggregate answers it. */
export type CaseLastResult = ScenarioLastResultSummary;

/**
 * The columns of the table. Under one suite the last result column carries the
 * time and the cost as well, so it is wider there.
 */
const WIDE_COLUMNS = "minmax(0,1fr) 290px 112px";
const NARROW_COLUMNS = "minmax(0,1fr) 170px 112px";
/** A set that runs from code has no controls, and a last run column instead. */
const EXTERNAL_COLUMNS = "minmax(0,1fr) 290px 110px";

export type CasesTableProps = {
  groups: CaseGroup[];
  /** True in All test cases, where each suite heads its own rows. */
  showGroupHeadings: boolean;
  lastResults: Map<string, CaseLastResult>;
  /** True while the last-result cells are still on their way. */
  isLastResultsLoading: boolean;
  /** The test suites a case can be moved into. */
  suites: TestSuiteEntry[];
  canManage: boolean;
  runningCaseId?: string | null;
  onSelectSuite: (suiteId: string) => void;
  onRowClick: (testCase: TestCase) => void;
  /** Opens the run dialog for the case. */
  onRunCase: (testCase: TestCase) => void;
  onEdit: (testCase: TestCase) => void;
  /** Opens the version history drawer of the case. */
  onHistory: (testCase: TestCase) => void;
  onDuplicate: (testCase: TestCase) => void;
  onMoveToSuite: (testCase: TestCase, suiteId: string | null) => void;
  onOpenLastRun: (testCase: TestCase) => void;
  onArchive: (testCase: TestCase) => void;
};

/** The card every Agent Testing table is drawn inside. */
function TableCard({ children, ...rest }: React.ComponentProps<typeof Box>) {
  return (
    <Box
      borderWidth="1px"
      borderColor="border"
      borderRadius="xl"
      background="bg.panel"
      overflow="hidden"
      boxShadow="0 1px 2px rgb(16 16 32 / 0.04)"
      {...rest}
    >
      {children}
    </Box>
  );
}

/** The line of column names above the rows. */
function TableHeaderRow({
  templateColumns,
  children,
}: {
  templateColumns: string;
  children: React.ReactNode;
}) {
  return (
    <Box
      display="grid"
      gridTemplateColumns={templateColumns}
      columnGap={3}
      alignItems="center"
      paddingX={4}
      paddingY={2}
      background={TABLE_HEADER_BG}
      borderBottomWidth="1px"
      borderBottomColor="border"
      fontSize="10.5px"
      fontWeight="semibold"
      textTransform="uppercase"
      letterSpacing="0.025em"
      color={FG_FAINT}
    >
      {children}
    </Box>
  );
}

export function CasesTable({
  groups,
  showGroupHeadings,
  lastResults,
  isLastResultsLoading,
  suites,
  canManage,
  runningCaseId,
  onSelectSuite,
  onRowClick,
  onRunCase,
  onEdit,
  onHistory,
  onDuplicate,
  onMoveToSuite,
  onOpenLastRun,
  onArchive,
}: CasesTableProps) {
  const templateColumns = showGroupHeadings ? NARROW_COLUMNS : WIDE_COLUMNS;

  return (
    <TableCard data-testid="agent-testing-cases-table">
      <TableHeaderRow templateColumns={templateColumns}>
        <Text as="span">Test case</Text>
        <Text as="span">Last result</Text>
        <Text as="span" />
      </TableHeaderRow>

      {groups.map((group, index) => (
        <Box key={group.id}>
          {showGroupHeadings && (
            <FolderHeaderRow
              name={group.name}
              caseCount={group.cases.length}
              templateColumns={templateColumns}
              aggregateSpan={2}
              separated={index > 0}
              onClick={
                group.id === UNFILED_GROUP_ID
                  ? undefined
                  : () => onSelectSuite(group.id)
              }
            >
              <GroupAggregate group={group} lastResults={lastResults} />
            </FolderHeaderRow>
          )}
          <Box
            css={{
              "& > * + *": {
                borderTopWidth: "1px",
                borderTopColor: "var(--chakra-colors-border-muted)",
              },
            }}
          >
            {group.cases.map((testCase) => (
              <CaseRow
                key={testCase.id}
                testCase={testCase}
                templateColumns={templateColumns}
                lastResult={lastResults.get(testCase.id)}
                isLastResultsLoading={isLastResultsLoading}
                showMetricsInline={!showGroupHeadings}
                suites={suites}
                canManage={canManage}
                isRunning={runningCaseId === testCase.id}
                onRowClick={onRowClick}
                onRunCase={onRunCase}
                onEdit={onEdit}
                onHistory={onHistory}
                onDuplicate={onDuplicate}
                onMoveToSuite={onMoveToSuite}
                onOpenLastRun={onOpenLastRun}
                onArchive={onArchive}
              />
            ))}
          </Box>
        </Box>
      ))}
    </TableCard>
  );
}

/** How the last run of a whole group went, beside its name. */
function GroupAggregate({
  group,
  lastResults,
}: {
  group: CaseGroup;
  lastResults: Map<string, CaseLastResult>;
}) {
  const groupResults = group.cases
    .map((testCase) => lastResults.get(testCase.id))
    .filter((result): result is CaseLastResult => !!result);

  if (groupResults.length === 0) return null;

  return <RunMetricsSummary summary={summaryFromLastResults(groupResults)} />;
}

function CaseRow({
  testCase,
  templateColumns,
  lastResult,
  isLastResultsLoading,
  showMetricsInline,
  suites,
  canManage,
  isRunning,
  onRowClick,
  onRunCase,
  onEdit,
  onHistory,
  onDuplicate,
  onMoveToSuite,
  onOpenLastRun,
  onArchive,
}: {
  testCase: TestCase;
  templateColumns: string;
  lastResult?: CaseLastResult;
  isLastResultsLoading: boolean;
  showMetricsInline: boolean;
  suites: TestSuiteEntry[];
  canManage: boolean;
  isRunning: boolean;
  onRowClick: (testCase: TestCase) => void;
  onRunCase: (testCase: TestCase) => void;
  onEdit: (testCase: TestCase) => void;
  onHistory: (testCase: TestCase) => void;
  onDuplicate: (testCase: TestCase) => void;
  onMoveToSuite: (testCase: TestCase, suiteId: string | null) => void;
  onOpenLastRun: (testCase: TestCase) => void;
  onArchive: (testCase: TestCase) => void;
}) {
  return (
    <Box
      display="grid"
      gridTemplateColumns={templateColumns}
      columnGap={3}
      alignItems="center"
      paddingX={4}
      paddingY="10px"
      cursor="pointer"
      _hover={{ background: ROW_HOVER_BG }}
      onClick={() => onRowClick(testCase)}
      data-testid={`case-row-${testCase.name}`}
    >
      <HStack gap={1.5} minWidth={0} flexWrap="wrap">
        <Text fontSize="12.5px" fontWeight="medium" color="fg" truncate>
          {testCase.name}
        </Text>
        <TagList labels={testCase.labels} tone="pastel" />
      </HStack>

      <LastResultCell
        lastResult={lastResult}
        isLoading={isLastResultsLoading}
        showMetricsInline={showMetricsInline}
      />

      <HStack
        gap={1}
        justify="flex-end"
        onClick={(event) => event.stopPropagation()}
      >
        {canManage && (
          <RunCaseButton
            caseName={testCase.name}
            isRunning={isRunning}
            onOpen={() => onRunCase(testCase)}
          />
        )}
        <CaseRowActionsMenu
          testCase={testCase}
          suites={suites}
          canManage={canManage}
          hasLastRun={!!lastResult}
          onEdit={onEdit}
          onHistory={onHistory}
          onDuplicate={onDuplicate}
          onMoveToSuite={onMoveToSuite}
          onOpenLastRun={onOpenLastRun}
          onArchive={onArchive}
        />
      </HStack>
    </Box>
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
      <HStack gap={2.5} minWidth={0}>
        {label}
        {metrics}
      </HStack>
    );
  }

  return (
    <Tooltip content={metrics} disabled={!hasMetrics}>
      <HStack gap={2.5} minWidth={0}>
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
  onHistory,
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
  onHistory: (testCase: TestCase) => void;
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
          minWidth="24px"
          height="24px"
          paddingX={0}
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
        <Menu.Item
          value="history"
          onClick={(event) => {
            stop(event);
            onHistory(testCase);
          }}
        >
          History
        </Menu.Item>
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
    <TableCard data-testid="agent-testing-external-cases-table">
      <TableHeaderRow templateColumns={EXTERNAL_COLUMNS}>
        <Text as="span">Test case</Text>
        <Text as="span" />
        <Text as="span" textAlign="right">
          Last run
        </Text>
      </TableHeaderRow>
      <Box
        css={{
          "& > * + *": {
            borderTopWidth: "1px",
            borderTopColor: "var(--chakra-colors-border-muted)",
          },
        }}
      >
        {cases.map((externalCase) => (
          <Box
            key={externalCase.scenarioId}
            display="grid"
            gridTemplateColumns={EXTERNAL_COLUMNS}
            columnGap={3}
            alignItems="center"
            paddingX={4}
            paddingY="10px"
            cursor="pointer"
            _hover={{ background: ROW_HOVER_BG }}
            onClick={() => onRowClick(externalCase.scenarioId)}
            data-testid={`external-case-row-${externalCase.name}`}
          >
            <Text fontSize="12.5px" fontWeight="medium" color="fg" truncate>
              {externalCase.name}
            </Text>
            <Box />
            <Text
              fontSize="11px"
              color={FG_FAINT}
              whiteSpace="nowrap"
              textAlign="right"
            >
              {format(externalCase.lastRunAt, "MMM d, HH:mm")}
            </Text>
          </Box>
        ))}
      </Box>
    </TableCard>
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
