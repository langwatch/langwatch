/**
 * The step a submission buckets at.
 *
 * A third value that looks like a parameter and deliberately is not:
 * `period_granularity_seconds` is supplied by whatever surface is showing the
 * chart, exactly as the period is, and the backend refuses a request that sends
 * it among its own named parameters. Offering it as a filled-in parameter would
 * be offering the member a way to be refused.
 *
 * Only the steps the contract admits are offered. An arbitrary number is not a
 * finer control but a broken one: an off-list step is refused outright, and one
 * that fits the bucket budget only by accident produces a chart whose buckets
 * silently stop lining up with everyone else's.
 *
 * @see ~/server/analytics/lwql/timeWindow — the contract this fills
 * @see specs/analytics/lwql-workbench.feature
 */

import { Button, HStack, Stack, Text } from "@chakra-ui/react";

// The leaf module, never the barrel — same reason the time-window editor reads
// it: `timeWindow.ts` is import-free so the browser can share the contract's
// names and steps without dragging the executor in behind them.
import {
  type LangWatchQLGranularityStep,
  LWQL_GRANULARITY_STEPS,
  LWQL_PERIOD_GRANULARITY_PARAMETER,
} from "~/server/analytics/lwql/timeWindow";

/** What each admitted step is called where a person reads it. */
const STEP_LABELS: Readonly<Record<number, string>> = {
  1: "1 second",
  60: "1 minute",
  3600: "1 hour",
};

/** The short form for the buttons, which sit in a row. */
const STEP_SHORT_LABELS: Readonly<Record<number, string>> = {
  1: "1s",
  60: "1m",
  3600: "1h",
};

export interface LangWatchQLGranularityPickerProps {
  /** The step the next submission carries. */
  value: number;
  onChange: (granularitySeconds: LangWatchQLGranularityStep) => void;
  /**
   * The step the visible answer was actually bucketed at, when it reports one.
   * `undefined` before anything has run, or when the statement does not declare
   * the parameter.
   */
  ranAtSeconds?: number | undefined;
  /**
   * The step the caller asked for, present only when the run coarsened. No
   * current workbench door coarsens — it refuses — but a result that says it
   * coarsened must not be read as one that honoured the request.
   */
  coarsenedFromSeconds?: number | undefined;
}

export function LangWatchQLGranularityPicker({
  value,
  onChange,
  ranAtSeconds,
  coarsenedFromSeconds,
}: LangWatchQLGranularityPickerProps) {
  return (
    <Stack gap={2} width="full" data-testid="lwql-granularity">
      <HStack gap={2}>
        <Text fontSize="13px" fontWeight="600">
          Granularity
        </Text>
        <Text fontSize="12px" color="fg.muted" fontFamily="mono">
          {`{${LWQL_PERIOD_GRANULARITY_PARAMETER}:UInt32}`}
        </Text>
      </HStack>

      <HStack gap={2} flexWrap="wrap">
        {LWQL_GRANULARITY_STEPS.map((step) => (
          <Button
            key={step}
            size="xs"
            variant={step === value ? "solid" : "outline"}
            aria-pressed={step === value}
            aria-label={STEP_LABELS[step]}
            onClick={() => onChange(step)}
          >
            {STEP_SHORT_LABELS[step]}
          </Button>
        ))}
      </HStack>

      {coarsenedFromSeconds !== undefined && ranAtSeconds !== undefined && (
        <Text
          fontSize="12px"
          color="fg.muted"
          data-testid="granularity-coarsened"
        >
          {`Too many buckets at ${STEP_LABELS[coarsenedFromSeconds] ?? `${coarsenedFromSeconds} seconds`}, so this ran at ${STEP_LABELS[ranAtSeconds] ?? `${ranAtSeconds} seconds`}.`}
        </Text>
      )}
    </Stack>
  );
}
