/**
 * What the results column reads while it has nothing to show: the read that
 * failed, the read that is still going, the window that holds no run, and the
 * run the address names before its first scenario has reported.
 *
 * @see specs/features/agent-testing/results-tabs.feature
 */

import {
  Box,
  EmptyState,
  Skeleton,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { RefreshCw } from "lucide-react";
import type { Period, RelativePresetKey } from "~/components/PeriodSelector";
import { HandledErrorAlert } from "~/features/errors";
import { FG_MUTED } from "../shared/design";
import { SmallButton } from "../shared/SmallButton";
import type { PeriodControls } from "./period-controls";

const DAY_MS = 86_400_000;

/** The next window to offer when nothing ran inside the one on screen. */
export function nextWiderWindow(period: Period): {
  key: RelativePresetKey;
  label: string;
} {
  const days = Math.round(
    (period.endDate.getTime() - period.startDate.getTime()) / DAY_MS,
  );
  if (days < 90) return { key: "90d", label: "Show the last 90 days" };
  return { key: "1y", label: "Show the last year" };
}

export function RunsLoadError({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry: () => void;
}) {
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

export function RunsLoadingSkeleton() {
  return (
    <VStack align="stretch" gap={2}>
      <Skeleton height="36px" />
      <Skeleton height="36px" />
      <Skeleton height="36px" />
    </VStack>
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
      <SmallButton
        onClick={() => setRelativePeriod(wider.key)}
        data-testid="widen-period-button"
      >
        {wider.label}
      </SmallButton>
    </VStack>
  );
}

/**
 * The address names a run the window does not hold. A link opened right after
 * a run was started lands here before the first scenario has reported, and
 * the run then reads as one that is coming, not as one that happened in the
 * past. The live updates fill the column in as the scenarios report. The
 * period button stays, for the reader who opened an old link instead.
 */
export function WaitingForFirstRun({
  period,
  setRelativePeriod,
}: Pick<PeriodControls, "period" | "setRelativePeriod">) {
  const wider = nextWiderWindow(period);

  return (
    <VStack
      align="center"
      gap={3}
      paddingY={10}
      data-testid="waiting-for-first-run"
    >
      <Spinner size="sm" color={FG_MUTED} />
      <Text fontSize="12.5px" fontWeight="medium" textAlign="center">
        Waiting for the first result
      </Text>
      <Text
        fontSize="12.5px"
        color={FG_MUTED}
        textAlign="center"
        maxWidth="360px"
      >
        This run has not reported a scenario yet. The results appear here as
        they arrive.
      </Text>
      <Text fontSize="11.5px" color={FG_MUTED} textAlign="center">
        Looking for an older run instead?
      </Text>
      <SmallButton
        onClick={() => setRelativePeriod(wider.key)}
        data-testid="widen-period-button"
      >
        {wider.label}
      </SmallButton>
    </VStack>
  );
}
