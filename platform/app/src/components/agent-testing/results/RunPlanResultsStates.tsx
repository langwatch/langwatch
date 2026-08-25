/**
 * What the results column reads while it has nothing to show: the read that
 * failed, the read that is still going, and the window that holds no run.
 *
 * @see specs/features/agent-testing/results-tabs.feature
 */

import { Box, Button, EmptyState, Skeleton, VStack } from "@chakra-ui/react";
import { FlaskConical, RefreshCw } from "lucide-react";
import type { Period, RelativePresetKey } from "~/components/PeriodSelector";
import { HandledErrorAlert } from "~/features/errors";
import type { PeriodControls } from "./period-controls";

const DAY_MS = 86_400_000;

/** The next window to offer when nothing ran inside the one on screen. */
function nextWiderWindow(period: Period): {
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
        <Button size="sm" variant="outline" onClick={onRetry}>
          <RefreshCw size={14} /> Try again
        </Button>
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
    <EmptyState.Root paddingY={12}>
      <EmptyState.Content>
        <EmptyState.Indicator>
          <FlaskConical size={28} />
        </EmptyState.Indicator>
        <EmptyState.Title>No run in this period</EmptyState.Title>
        <EmptyState.Description>
          This run plan has no run inside the selected period.
        </EmptyState.Description>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setRelativePeriod(wider.key)}
          data-testid="widen-period-button"
        >
          {wider.label}
        </Button>
      </EmptyState.Content>
    </EmptyState.Root>
  );
}
