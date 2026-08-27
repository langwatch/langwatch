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
import { CONTENT_COLUMN_GUTTER, ContentColumn } from "../shared/ContentColumn";
import { FG_MUTED } from "../shared/design";
import { periodDays } from "../shared/PeriodPicker";
import { SmallButton } from "../shared/SmallButton";
import { AGENT_TESTING_RAIL_WIDTH } from "../shared/TabLayout";
import type { AgentTestingRoutingState } from "../useAgentTestingRouting";
import { FlatRowsTable, GroupedRowsTable } from "./GroupedRowsTable";
import { PlanRowsTable } from "./PlanRowsTable";
import { ResultsChartsBlock } from "./ResultsChartsBlock";
import { ResultsFilterRow } from "./ResultsFilterRow";
import type { ResultRow } from "./result-atoms";
import type { RunPlan } from "./run-plans";
import { useResultGroups } from "./useResultGroups";
import { useResultsView } from "./useResultsView";

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
  setRelativePeriod,
  onSelectPlan,
  onSelectRun,
  onEditPlan,
  onNewRunPlan,
  isSseConnected,
}: ResultsListProps) {
  const view = useResultsView(routingState);

  const results = useResultGroups({
    plans,
    period,
    periodMode,
    grouping: view.grouping,
    filters: view.filters,
    openedKeys: view.openedKeys,
    isSseConnected,
  });

  const days = periodDays(period);
  const isLoading = isPlansLoading || results.isLoading;

  const openRun = (row: ResultRow) => onSelectRun(row.planSlug, row.runId);

  return (
    <ContentColumn
      railWidth={AGENT_TESTING_RAIL_WIDTH + CONTENT_COLUMN_GUTTER}
      data-testid="agent-testing-run-plans"
    >
      <HStack gap={2} height="32px">
        <Text fontSize="14px" fontWeight="semibold" color="fg">
          Test Runs
        </Text>
        <Text fontSize="11.5px" color={FG_MUTED}>
          {results.totals.executions === 1
            ? "1 execution"
            : `${results.totals.executions} executions`}
        </Text>
        <Box flex={1} />
        <SmallButton onClick={onNewRunPlan}>
          <Plus size={13} />
          New run plan
        </SmallButton>
      </HStack>

      {isLoading ? (
        <VStack align="stretch" gap={2}>
          <Skeleton height="44px" />
          <Skeleton height="44px" />
          <Skeleton height="44px" />
        </VStack>
      ) : !hasAnyPlans ? (
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
      ) : (
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
            setRelativePeriod={setRelativePeriod}
          />

          {view.isChartsShown ? (
            <ResultsChartsBlock
              totals={results.totals}
              buckets={results.buckets}
            />
          ) : null}

          {view.grouping === "plan" ? (
            <PlanRowsTable
              rows={results.planRows}
              days={days}
              resolveTargetName={results.resolveTargetName}
              onSelectPlan={onSelectPlan}
              onEditPlan={onEditPlan}
            />
          ) : null}

          {view.grouping === "scenario" || view.grouping === "target" ? (
            <GroupedRowsTable
              kind={view.grouping}
              groups={results.groups}
              openedKeys={view.openedKeys}
              onToggleOpen={view.onToggleOpen}
              rowsByGroupKey={results.rowsByGroupKey}
              resolveTargetName={results.resolveTargetName}
              onOpenRun={openRun}
            />
          ) : null}

          {view.grouping === "none" ? (
            <FlatRowsTable
              rows={results.rows}
              resolveTargetName={results.resolveTargetName}
              onOpenRun={openRun}
              hasMore={results.hasMore}
            />
          ) : null}
        </>
      )}
    </ContentColumn>
  );
}
