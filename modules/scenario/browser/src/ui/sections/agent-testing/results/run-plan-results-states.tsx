/**
 * What the results column reads while it has nothing to show: the read that
 * failed, the read that is still going, the window that holds no run, and
 * the run the address names before its first scenario has reported.
 * @see specs/features/agent-testing/results-tabs.feature
 */

import {
  Box,
  EmptyState,
  HStack,
  Skeleton,
  Spinner,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { RefreshCw } from "lucide-react";

import { HandledErrorAlert } from "../../../../behavior/errors.tsx";
import { FG_MUTED, TABLE_HEADER_BG } from "../../../../model/agent-testing/shared/design.ts";
import type { Period, RelativePresetKey } from "../../../../model/analytics/period.ts";
import { ContentColumn } from "../../../elements/agent-testing/shared/content-column.tsx";
import { SmallButton } from "../../../elements/agent-testing/shared/small-button.tsx";
import type { PeriodControls } from "./period-controls.ts";
import { RUNS_SIDEBAR_WIDTH, RunEntriesSkeleton } from "./runs-sidebar.tsx";

const DAY_MS = 86_400_000;

/** The next window to offer when nothing ran inside the one on screen. */
export function nextWiderWindow(period: Period): {
  key: RelativePresetKey;
  label: string;
} {
  const days = Math.round(
    (period.endDate.epochMilliseconds - period.startDate.epochMilliseconds) / DAY_MS,
  );
  if (days < 90) return { key: "90d", label: "Show the last 90 days" };
  return { key: "1y", label: "Show the last year" };
}

export function RunsLoadError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <EmptyState.Root paddingY={12}>
      <EmptyState.Content>
        <Box maxWidth="420px" width="100%">
          <HandledErrorAlert error={error} fallbackTitle="Couldn't load runs" />
        </Box>
        <SmallButton onClick={onRetry}>
          <RefreshCw size={13} /> Try again
        </SmallButton>
      </EmptyState.Content>
    </EmptyState.Root>
  );
}

/** The results table while the runs load: its frame, its header bar and a few rows. */
export function RunsLoadingSkeleton() {
  return (
    <Box
      borderWidth="1px"
      borderColor="border"
      borderRadius="xl"
      overflow="hidden"
      data-testid="run-results-loading"
    >
      <Box
        height="32px"
        background={TABLE_HEADER_BG}
        borderBottomWidth="1px"
        borderBottomColor="border"
      />
      {Array.from({ length: 5 }, (_, index) => (
        <Box
          key={index}
          display="grid"
          gridTemplateColumns="120px minmax(0,1fr) 130px"
          columnGap={3}
          alignItems="center"
          paddingX={4}
          paddingY="10px"
          borderTopWidth={index === 0 ? "0" : "1px"}
          borderTopColor="border"
        >
          <Skeleton height="18px" width="60px" borderRadius="full" />
          <Skeleton height="12px" width={`${45 + ((index * 17) % 35)}%`} />
          <Skeleton height="12px" width="72px" justifySelf="end" />
        </Box>
      ))}
    </Box>
  );
}

/** The run plan page before the plan resolves: the runs rail and the results column. */
export function RunPlanDetailSkeleton({ testId }: { testId?: string }) {
  return (
    <HStack align="stretch" gap={0} width="full" height="full" data-testid={testId}>
      <VStack
        align="stretch"
        gap={1}
        width={`${RUNS_SIDEBAR_WIDTH}px`}
        flexShrink={0}
        paddingX={3}
        paddingY={4}
      >
        <Skeleton height="28px" width="88px" marginBottom={1} />
        <RunEntriesSkeleton />
      </VStack>
      <ContentColumn railWidth={RUNS_SIDEBAR_WIDTH}>
        <VStack align="stretch" gap={4}>
          <Skeleton height="24px" width="220px" />
          <RunsLoadingSkeleton />
        </VStack>
      </ContentColumn>
    </HStack>
  );
}

export function NoRunInPeriod({
  period,
  setRelativePeriod,
}: Pick<PeriodControls, "period" | "setRelativePeriod">) {
  const wider = nextWiderWindow(period);

  return (
    <VStack align="center" gap={3} paddingY={10}>
      <Text fontSize="12.5px" fontWeight="medium" textAlign="center">
        No run in this period
      </Text>
      <Text fontSize="12.5px" color={FG_MUTED} textAlign="center">
        This run plan has no run inside the selected period.
      </Text>
      <SmallButton onClick={() => setRelativePeriod(wider.key)} data-testid="widen-period-button">
        {wider.label}
      </SmallButton>
    </VStack>
  );
}

/**
 * The address names a run the window does not hold. A link opened right after a run was
 * started lands here before the first scenario has reported, and the run then reads as
 * one that is coming, not as one that happened in the past.
 */
export function WaitingForFirstRun({
  period,
  setRelativePeriod,
}: Pick<PeriodControls, "period" | "setRelativePeriod">) {
  const wider = nextWiderWindow(period);

  return (
    <VStack align="center" gap={3} paddingY={10} data-testid="waiting-for-first-run">
      <Spinner size="sm" color={FG_MUTED} />
      <Text fontSize="12.5px" fontWeight="medium" textAlign="center">
        Waiting for the first result
      </Text>
      <Text fontSize="12.5px" color={FG_MUTED} textAlign="center" maxWidth="360px">
        This run has not reported a scenario yet. The results appear here as they arrive.
      </Text>
      <Text fontSize="11.5px" color={FG_MUTED} textAlign="center">
        Looking for an older run instead?
      </Text>
      <SmallButton onClick={() => setRelativePeriod(wider.key)} data-testid="widen-period-button">
        {wider.label}
      </SmallButton>
    </VStack>
  );
}
