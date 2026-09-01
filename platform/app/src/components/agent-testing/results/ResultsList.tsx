/**
 * The Results tab list: the filter row, the charts it drives, and the table.
 *
 * Top to bottom, the order is deliberate. The filters read first, then the
 * numbers they move, then the rows themselves, so a person sets the question
 * before reading the answer. The charts start closed: the page opens on what
 * ran, not on a wall of figures nobody asked for yet.
 *
 * The four groupings draw different columns but are one table to the reader,
 * and all four read the same rows, so no control on the page can move one
 * number without moving the rest.
 *
 * @see specs/features/agent-testing/results-tabs.feature
 */

import {
  Box,
  EmptyState,
  HStack,
  Skeleton,
  Text,
  VStack,
} from "@chakra-ui/react";
import { FlaskConical, Plus } from "lucide-react";
import type {
  Period,
  PeriodMode,
  RelativePresetKey,
} from "~/components/PeriodSelector";
import {
  CONTENT_COLUMN_WIDE_MAX_WIDTH,
  ContentColumn,
} from "../shared/ContentColumn";
import { FG_MUTED } from "../shared/design";
import { periodDays } from "../shared/PeriodPicker";
import { SmallButton } from "../shared/SmallButton";
import type { AgentTestingRoutingState } from "../useAgentTestingRouting";
import { FlatRowsTable, GroupedRowsTable } from "./GroupedRowsTable";
import { PlanRowsTable } from "./PlanRowsTable";
import { ResultsChartsBlock } from "./ResultsChartsBlock";
import { ResultsFilterRow } from "./ResultsFilterRow";
import type { ResultGrouping, ResultRow } from "./result-atoms";
import type { RunPlan } from "./run-plans";
import { type UseResultGroupsResult, useResultGroups } from "./useResultGroups";
import { useResultsView } from "./useResultsView";
import { useRunPlanArchive } from "./useRunPlanArchive";

/** The title line: what the window holds, and the way to add a run plan. */
function ResultsHeader({
  executionCount,
  onNewRunPlan,
}: {
  executionCount: number;
  onNewRunPlan: () => void;
}) {
  return (
    <HStack gap={2} height="32px">
      {/* The count sits on the title's baseline. Centred, a smaller line beside
          a larger one reads as lifted off it. */}
      <HStack gap={2} alignItems="baseline" minWidth={0}>
        <Text fontSize="14px" fontWeight="semibold" color="fg">
          Test Runs
        </Text>
        <Text fontSize="11.5px" color={FG_MUTED}>
          {executionCount === 1
            ? "1 execution"
            : `${executionCount} executions`}
        </Text>
      </HStack>
      <Box flex={1} />
      <SmallButton onClick={onNewRunPlan}>
        <Plus size={13} />
        New run plan
      </SmallButton>
    </HStack>
  );
}

/** What stands in for the table while the reads are still out. */
function LoadingRows() {
  return (
    <VStack align="stretch" gap={2}>
      <Skeleton height="44px" />
      <Skeleton height="44px" />
      <Skeleton height="44px" />
    </VStack>
  );
}

/** What the tab says to a project that has never run anything. */
function NoRunsYet() {
  return (
    <EmptyState.Root paddingY={12}>
      <EmptyState.Content>
        <EmptyState.Indicator>
          <FlaskConical size={28} />
        </EmptyState.Indicator>
        <EmptyState.Title>No runs yet</EmptyState.Title>
        <EmptyState.Description>
          Run a test suite or a single scenario and the results land here.
        </EmptyState.Description>
      </EmptyState.Content>
    </EmptyState.Root>
  );
}

/** The table the chosen grouping draws. */
function ResultsTable({
  grouping,
  results,
  days,
  openedKeys,
  onToggleOpen,
  onSelectPlan,
  onEditPlan,
  onArchivePlan,
  isArchivingPlan,
  onOpenRun,
}: {
  grouping: ResultGrouping;
  results: UseResultGroupsResult;
  days: number;
  openedKeys: string[];
  onToggleOpen: (key: string) => void;
  onSelectPlan: (planSlug: string) => void;
  onEditPlan: (suiteId: string) => void;
  onArchivePlan: (plan: RunPlan) => void;
  isArchivingPlan: boolean;
  onOpenRun: (row: ResultRow) => void;
}) {
  if (grouping === "plan") {
    return (
      <PlanRowsTable
        rows={results.planRows}
        days={days}
        resolveTargetName={results.resolveTargetName}
        resolveTargetKind={results.resolveTargetKind}
        onSelectPlan={onSelectPlan}
        onEditPlan={onEditPlan}
        onArchivePlan={onArchivePlan}
        isArchiving={isArchivingPlan}
      />
    );
  }

  if (grouping === "scenario" || grouping === "target") {
    return (
      <GroupedRowsTable
        kind={grouping}
        groups={results.groups}
        openedKeys={openedKeys}
        onToggleOpen={onToggleOpen}
        rowsByGroupKey={results.rowsByGroupKey}
        resolveTargetName={results.resolveTargetName}
        resolveTargetKind={results.resolveTargetKind}
        onOpenRun={onOpenRun}
      />
    );
  }

  return (
    <FlatRowsTable
      rows={results.rows}
      resolveTargetName={results.resolveTargetName}
      onOpenRun={onOpenRun}
      hasMore={results.hasMore}
    />
  );
}

/** The filters, the charts they drive, and the table, in that order. */
function ResultsBody({
  view,
  results,
  period,
  periodMode,
  setPeriod,
  setRelativePeriod,
  days,
  onSelectPlan,
  onEditPlan,
  onArchivePlan,
  isArchivingPlan,
  onOpenRun,
}: {
  view: ReturnType<typeof useResultsView>;
  results: UseResultGroupsResult;
  period: Period;
  periodMode: PeriodMode;
  setPeriod: (startDate: Date, endDate: Date) => void;
  setRelativePeriod: (key: RelativePresetKey) => void;
  days: number;
  onSelectPlan: (planSlug: string) => void;
  onEditPlan: (suiteId: string) => void;
  onArchivePlan: (plan: RunPlan) => void;
  isArchivingPlan: boolean;
  onOpenRun: (row: ResultRow) => void;
}) {
  return (
    <>
      <ResultsFilterRow
        grouping={view.grouping}
        onGroupingChange={view.onGroupingChange}
        filters={view.filters}
        onFiltersChange={view.onFiltersChange}
        scenarioOptions={results.scenarioOptions}
        labelOptions={results.labelOptions}
        targetOptions={results.targetOptions}
        isChartsShown={view.isChartsShown}
        onChartsToggle={view.onChartsToggle}
        period={period}
        periodMode={periodMode}
        setPeriod={setPeriod}
        setRelativePeriod={setRelativePeriod}
      />

      {view.isChartsShown ? (
        <ResultsChartsBlock totals={results.totals} buckets={results.buckets} />
      ) : null}

      <ResultsTable
        grouping={view.grouping}
        results={results}
        days={days}
        openedKeys={view.openedKeys}
        onToggleOpen={view.onToggleOpen}
        onSelectPlan={onSelectPlan}
        onEditPlan={onEditPlan}
        onArchivePlan={onArchivePlan}
        isArchivingPlan={isArchivingPlan}
        onOpenRun={onOpenRun}
      />
    </>
  );
}

export type ResultsListProps = {
  /** Where the address stands, so the view can write its own params into it. */
  routingState: AgentTestingRoutingState;
  plans: RunPlan[];
  /** False while the project holds nothing that ever ran. */
  hasAnyPlans: boolean;
  isPlansLoading: boolean;
  period: Period;
  periodMode: PeriodMode;
  setPeriod: (startDate: Date, endDate: Date) => void;
  setRelativePeriod: (key: RelativePresetKey) => void;
  onSelectPlan: (planSlug: string) => void;
  onSelectRun: (planSlug: string, batchRunId: string) => void;
  onEditPlan: (suiteId: string) => void;
  onNewRunPlan: () => void;
  /** While the live stream is up the fallback polling stands down. */
  isSseConnected: boolean;
};

export function ResultsList({
  routingState,
  plans,
  hasAnyPlans,
  isPlansLoading,
  period,
  periodMode,
  setPeriod,
  setRelativePeriod,
  onSelectPlan,
  onSelectRun,
  onEditPlan,
  onNewRunPlan,
  isSseConnected,
}: ResultsListProps) {
  const view = useResultsView(routingState);
  const archive = useRunPlanArchive();

  const results = useResultGroups({
    plans,
    period,
    periodMode,
    grouping: view.grouping,
    filters: view.filters,
    openedKeys: view.openedKeys,
    isSseConnected,
  });

  const isLoading = isPlansLoading || results.isLoading;

  const openRun = (row: ResultRow) => onSelectRun(row.planSlug, row.runId);

  return (
    <ContentColumn
      columnMaxWidth={CONTENT_COLUMN_WIDE_MAX_WIDTH}
      data-testid="agent-testing-run-plans"
    >
      <ResultsHeader
        executionCount={results.totals.executions}
        onNewRunPlan={onNewRunPlan}
      />

      {isLoading ? (
        <LoadingRows />
      ) : !hasAnyPlans ? (
        <NoRunsYet />
      ) : (
        <ResultsBody
          view={view}
          results={results}
          period={period}
          periodMode={periodMode}
          setPeriod={setPeriod}
          setRelativePeriod={setRelativePeriod}
          days={periodDays(period)}
          onSelectPlan={onSelectPlan}
          onEditPlan={onEditPlan}
          onArchivePlan={archive.archivePlan}
          isArchivingPlan={archive.isArchiving}
          onOpenRun={openRun}
        />
      )}
    </ContentColumn>
  );
}
