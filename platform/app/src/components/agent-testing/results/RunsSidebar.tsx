/**
 * The runs of one run plan, newest first: the number of the run, the note the
 * person left with it, how long ago it started and how it went.
 *
 * @see specs/features/agent-testing/results-tabs.feature
 * @see specs/suites/run-notes.feature
 */

import { Box, Button, HStack, Spinner, Text, VStack } from "@chakra-ui/react";
import { ArrowLeft } from "lucide-react";
import type {
  Period,
  PeriodMode,
  RelativePresetKey,
} from "~/components/PeriodSelector";
import { PeriodSelector } from "~/components/PeriodSelector";
import { PassRateCircle } from "~/components/shared/PassRateIndicator";
import {
  type BatchRun,
  computeBatchRunSummary,
} from "~/components/suites/run-history-transforms";
import { useNow } from "~/hooks/useNow";
import { formatTimeAgoCompact } from "~/utils/formatTimeAgo";
import {
  batchNote,
  oneOffRunTitle,
  type RunPlan,
  runOrdinal,
} from "./run-plans";

export type RunsSidebarProps = {
  plan: RunPlan;
  batchRuns: BatchRun[];
  /** Runs in the window as the server counts them, which gives the run number. */
  totalBatchCount: number | null;
  selectedBatchRunId: string | null;
  onSelectRun: (batchRunId: string) => void;
  onBack: () => void;
  hasMore: boolean;
  onLoadMore: () => void;
  isLoading: boolean;
  /** A run that was just started and has no rows yet. */
  pendingBatchRunId: string | null;
  period: Period;
  periodMode: PeriodMode;
  setPeriod: (startDate: Date, endDate: Date) => void;
  setRelativePeriod: (key: RelativePresetKey) => void;
};

function SidebarItem({
  title,
  note,
  timeAgo,
  passRate,
  passedCount,
  isSelected,
  isPending,
  onClick,
  testId,
}: {
  title: string;
  note: string | null;
  timeAgo: string;
  passRate: number | null;
  passedCount: number | null;
  isSelected: boolean;
  isPending?: boolean;
  onClick?: () => void;
  testId: string;
}) {
  return (
    <VStack
      as="button"
      align="stretch"
      gap={0.5}
      width="full"
      paddingX={3}
      paddingY={2}
      borderRadius="lg"
      textAlign="left"
      cursor={onClick ? "pointer" : "default"}
      background={isSelected ? "bg.muted" : undefined}
      _hover={onClick ? { background: "bg.muted" } : undefined}
      onClick={onClick}
      aria-current={isSelected ? "true" : undefined}
      data-testid={testId}
      data-selected={isSelected ? "true" : undefined}
    >
      {/* The name line carries no result colour of its own: the circle under
          it is the one place the outcome reads. */}
      <HStack gap={1.5} width="full" data-testid={`${testId}-title`}>
        {isPending ? <Spinner size="xs" /> : null}
        <Text fontSize="xs" fontWeight="semibold" truncate>
          {title}
        </Text>
        <Box flex={1} />
        <Text fontSize="10px" color="fg.muted" whiteSpace="nowrap">
          {timeAgo}
        </Text>
      </HStack>

      {/* One line, with the whole note on hover, so a long note never grows
          the entry. */}
      {note ? (
        <Text
          fontSize="11px"
          color="fg.muted"
          truncate
          title={note}
          data-testid={`${testId}-note`}
        >
          {note}
        </Text>
      ) : null}

      {passRate !== null || passedCount !== null ? (
        <HStack gap={1} data-testid={`${testId}-result`}>
          <PassRateCircle passRate={passRate} size="8px" />
          <Text fontSize="11px" fontWeight="medium" color="fg.muted">
            {passRate === null ? "-" : `${Math.round(passRate)}%`}
          </Text>
          {passedCount !== null ? (
            <Text fontSize="11px" color="fg.muted">
              · {passedCount} passed
            </Text>
          ) : null}
        </HStack>
      ) : null}
    </VStack>
  );
}

export function RunsSidebar({
  plan,
  batchRuns,
  totalBatchCount,
  selectedBatchRunId,
  onSelectRun,
  onBack,
  hasMore,
  onLoadMore,
  isLoading,
  pendingBatchRunId,
  period,
  periodMode,
  setPeriod,
  setRelativePeriod,
}: RunsSidebarProps) {
  const now = useNow();

  const showPending =
    !!pendingBatchRunId &&
    !batchRuns.some((batch) => batch.batchRunId === pendingBatchRunId);

  return (
    <VStack
      align="stretch"
      gap={1}
      width="240px"
      flexShrink={0}
      height="full"
      paddingX={3}
      paddingY={4}
      borderRightWidth="1px"
      borderColor="border"
      overflow="auto"
      data-testid="agent-testing-runs-sidebar"
    >
      <Button
        size="xs"
        variant="ghost"
        justifyContent="flex-start"
        onClick={onBack}
      >
        <ArrowLeft size={14} /> Run plans
      </Button>

      {showPending ? (
        <SidebarItem
          title="Starting"
          note={null}
          timeAgo="now"
          passRate={null}
          passedCount={null}
          isSelected={false}
          isPending
          testId="runs-sidebar-pending"
        />
      ) : null}

      {batchRuns.map((batch, index) => {
        const summary = computeBatchRunSummary({ batchRun: batch });
        const ordinal = runOrdinal({
          index,
          totalCount: totalBatchCount,
          loadedCount: batchRuns.length,
        });
        const title =
          (plan.kind === "one-off"
            ? oneOffRunTitle(batch.scenarioRuns)
            : null) ?? `Run #${ordinal}`;

        return (
          <SidebarItem
            key={batch.batchRunId}
            title={title}
            note={batchNote(batch.scenarioRuns)}
            timeAgo={formatTimeAgoCompact(batch.timestamp, now)}
            passRate={summary.passRate}
            passedCount={summary.passedCount}
            isSelected={selectedBatchRunId === batch.batchRunId}
            onClick={() => onSelectRun(batch.batchRunId)}
            testId={`runs-sidebar-item-${batch.batchRunId}`}
          />
        );
      })}

      {!isLoading && batchRuns.length === 0 && !showPending ? (
        <Text fontSize="xs" color="fg.muted" paddingX={1} paddingTop={2}>
          No run in this period.
        </Text>
      ) : null}

      {hasMore ? (
        <Button size="xs" variant="outline" onClick={onLoadMore}>
          Load More...
        </Button>
      ) : null}

      <Box flex={1} minHeight={4} />

      <Box paddingLeft={1}>
        <PeriodSelector
          period={period}
          mode={periodMode}
          setPeriod={setPeriod}
          setRelativePeriod={setRelativePeriod}
          size="xs"
          triggerVariant="ghost"
          placement="top-start"
        />
      </Box>
    </VStack>
  );
}
