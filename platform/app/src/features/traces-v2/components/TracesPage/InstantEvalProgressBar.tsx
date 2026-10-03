import { Box, Button, HStack, Progress, Text } from "@chakra-ui/react";
import { Square } from "lucide-react";
import type React from "react";
import type { InstantEvalRunPhase } from "../../stores/instantEvalRunStore";

/** The phases the bar is shown in: every one before the run has settled. */
export type InstantEvalBarPhase = Exclude<InstantEvalRunPhase, "settled">;

interface InstantEvalProgressBarProps {
  /** Rows judged so far. */
  judged: number;
  /** Rows the run will judge, or null while it is still counting them. */
  total: number | null;
  matched: number;
  /** The question, so the bar says what is being judged. */
  question: string;
  phase: InstantEvalBarPhase;
  runId?: string;
  canStop?: boolean;
  hasReportedCounts?: boolean;
  isReadUnavailable?: boolean;
  onStop: () => void;
}

/** The bar's own words: what has been judged, what matched, and the stop. */
export function instantEvalProgressCopy({
  judged,
  total,
  matched,
  phase = "judging",
}: {
  judged: number;
  total: number | null;
  matched: number;
  phase?: InstantEvalBarPhase;
}): string {
  const totalText = total === null ? "…" : total.toLocaleString();
  const counters = `${judged.toLocaleString()} / ${totalText} · ${matched.toLocaleString()} matched`;
  if (phase === "interrupted")
    return `Last reported: ${counters} · may be incomplete`;
  if (phase === "unavailable")
    return `Last reported: ${counters} · may be outdated`;
  if (phase === "judging") return `Judging ${counters}`;
  // A stop waits for the classifications already in flight, and an ended run
  // for its last verdicts: both say so, with counters that still move.
  return phase === "stopping"
    ? `Stopping ${counters}`
    : `Reading the last verdicts ${counters}`;
}

/** Where the bar sits, 0 to 100. Null while the run is still counting. */
export function instantEvalProgressPercent({
  judged,
  total,
}: {
  judged: number;
  total: number | null;
}): number | null {
  if (total === null || total <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((judged / total) * 100)));
}

/**
 * A determinate bar over the table while an Instant Eval run judges the
 * query's rows. Reads the run's own counters, so it moves as pages of
 * verdicts land, and the Stop button asks the run to cancel: the chip stays,
 * marked partial, with what was judged so far.
 *
 * Spec: specs/traces-v2/instant-eval-search.feature ("A determinate bar reads
 * the run's counters").
 */
export const InstantEvalProgressBar: React.FC<InstantEvalProgressBarProps> = ({
  judged,
  total,
  matched,
  question,
  phase,
  runId,
  canStop = phase === "judging",
  hasReportedCounts = true,
  isReadUnavailable = false,
  onStop,
}) => {
  const impaired = phase === "interrupted" || phase === "unavailable";
  const percent = instantEvalProgressPercent({ judged, total });
  return (
    <Box
      role="status"
      aria-label="Instant Eval progress"
      data-testid="instant-eval-progress"
      position={impaired ? "relative" : "absolute"}
      flexShrink={0}
      top={0}
      left={0}
      right={0}
      zIndex={3}
      paddingX={3}
      paddingY={2}
      bg="bg.panel"
      borderBottomWidth="1px"
      borderColor="border.muted"
      boxShadow="sm"
    >
      <HStack justify="space-between" gap={3} marginBottom={1.5}>
        <HStack gap={2} minWidth={0}>
          {hasReportedCounts && (
            <Text textStyle="sm" color="fg" fontVariantNumeric="tabular-nums">
              {instantEvalProgressCopy({ judged, total, matched, phase })}
            </Text>
          )}
          <Text textStyle="xs" color="fg.muted" truncate title={question}>
            {question}
          </Text>
        </HStack>
        <Button
          variant="ghost"
          size="xs"
          onClick={onStop}
          disabled={!canStop}
          aria-label="Stop judging"
        >
          <Square size={12} />
          Stop
        </Button>
      </HStack>
      {impaired && (
        <Box role="alert" color="fg.warning" textStyle="sm">
          <Text fontWeight="medium">
            {phase === "interrupted"
              ? "Progress reporting was interrupted."
              : "Run status unavailable."}
          </Text>
          <Text>
            {phase === "interrupted"
              ? "A processing step was disabled. Work may still be running and these counts may be incomplete. Contact your administrator or support with this run ID."
              : "Work may still be running. Last reported counts may be outdated. Run status will be checked again."}
          </Text>
          {phase === "interrupted" && isReadUnavailable && (
            <Text>
              Run status is also unavailable. Last reported counts may be
              outdated.
            </Text>
          )}
          {runId && (
            <Text>
              Run ID:{" "}
              <Text as="code" display="inline" userSelect="all">
                {runId}
              </Text>
            </Text>
          )}
        </Box>
      )}
      {!impaired && (
        <Progress.Root
          value={percent}
          min={0}
          max={100}
          colorPalette="orange"
          size="xs"
          aria-label="Rows judged"
        >
          <Progress.Track>
            <Progress.Range css={{ transition: "width 0.5s ease-in-out" }} />
          </Progress.Track>
        </Progress.Root>
      )}
    </Box>
  );
};
