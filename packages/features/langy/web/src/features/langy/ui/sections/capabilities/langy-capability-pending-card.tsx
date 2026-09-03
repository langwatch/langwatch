/**
 * The in-progress half of a capability card.
 *
 * A capability used to appear only once it had SETTLED — while it ran, the call
 * fell through to the generic activity collapser and rendered as a bare word
 * ("Coding") over a line of naked text. So the richest moment of a turn, the
 * part where you want to know what Langy is doing to your data, was its ugliest.
 *
 * Now a capability is a card for its whole life: this shell while it runs
 * (surface overline + a present-tense headline naming the thing being done +
 * an indeterminate bar), swapped for the settled card the moment output lands.
 * Same shell, same overline, same border — the card doesn't jump, it fills in.
 *
 * PROGRESSIVE: when the call is a CLI read whose query the panel can already
 * run (`command`), rows start appearing UNDER the running headline while the
 * agent is still working — fetched fresh through the product's own API with
 * the viewer's session (see `useCapabilityData`). The settled card then
 * reconciles against the result's own references. A resource with no query
 * hydrator shows the plain pending shell, exactly as before.
 */
import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import { keyframes } from "@emotion/react";
import { useReducedMotion } from "../../../../../behavior/use-reduced-motion";
import { useCapabilityData } from "../../../behavior/use-capability-data";
import { formatLangyPreviewCount, formatLangyProgressCount } from "../../../../../index";
import {
  type CapabilityCommand,
  type LangyProgressSample,
  LangyInterruptedNote,
  langyThinkingShimmerStyles,
  useProjectedProgress,
} from "../../../../../index";
import type { CapabilitySurface } from "../../../../../index";
import { CapabilityRow, LangyCapabilityCard } from "./langy-capability-card";

const rowAppear = keyframes`
  from { opacity: 0; }
  to   { opacity: 1; }
`;

export function LangyCapabilityPendingCard({
  surface,
  overline,
  headline,
  detail,
  command,
  progress,
  progressSample,
  interrupted = false,
}: {
  surface: CapabilitySurface;
  overline: string;
  /** Present tense: "Searching traces", "Creating evaluator". */
  headline: string;
  /** The concrete thing being acted on, when the call's input names one. */
  detail?: string;
  /** The parsed CLI command, when known — enables the live row preview. */
  command?: CapabilityCommand | null;
  /** Measured batch progress belongs on this card, not in a duplicate row. */
  progress?: number | null;
  progressSample?: LangyProgressSample | null;
  /**
   * The turn ended before this call reported anything. The shell keeps the rows
   * it did find and drops every moving part, so a stopped search stops saying
   * it is searching.
   */
  interrupted?: boolean;
}) {
  const reduceMotion = useReducedMotion();

  // Start-frame hydration: only the query exists yet. Idle (and rendering
  // nothing extra) unless this resource has a query hydrator.
  const preview = useCapabilityData({ command: command ?? null });
  const percent = useProjectedProgress({ progress, sample: progressSample });

  return (
    <LangyCapabilityCard
      // Neutral tone on purpose — a create that hasn't landed is not a "created".
      tone="read"
      surface={surface}
      overline={overline}
      deepLink={false}
      title={
        <PendingTitle
          headline={headline}
          detail={detail}
          interrupted={interrupted}
          reduceMotion={reduceMotion}
        />
      }
    >
      {interrupted ? (
        <LangyInterruptedNote />
      ) : (
        <PendingProgress
          sample={progressSample ?? null}
          percent={percent}
          reduceMotion={reduceMotion}
        />
      )}
      {preview.rows.length > 0 ? (
        <VStack align="stretch" gap={0}>
          {preview.rows.map((row) => (
            <Box
              key={row.id}
              css={reduceMotion ? undefined : { animation: `${rowAppear} 0.3s ease-out both` }}
            >
              <CapabilityRow primary={row.primary ?? row.id} secondary={row.secondary} />
            </Box>
          ))}
          <Text textStyle="2xs" color="fg.subtle" paddingX={2} paddingTop={1}>
            {formatLangyPreviewCount(preview)}
          </Text>
        </VStack>
      ) : null}
    </LangyCapabilityCard>
  );
}

/** The headline and the command line, in the shell's title slot. */
function PendingTitle({
  headline,
  detail,
  interrupted,
  reduceMotion,
}: {
  headline: string;
  detail?: string;
  interrupted: boolean;
  reduceMotion: boolean;
}) {
  const shimmer =
    reduceMotion || interrupted
      ? { ...langyThinkingShimmerStyles, animation: "none" }
      : langyThinkingShimmerStyles;

  return (
    <VStack align="stretch" gap={1}>
      <HStack gap={2} align="baseline">
        <Box
          textStyle="sm"
          fontWeight="640"
          lineHeight="1.3"
          color={interrupted ? "fg.muted" : undefined}
          css={interrupted ? undefined : shimmer}
          role="status"
          aria-live="polite"
        >
          {interrupted ? headline : `${headline}…`}
        </Box>
      </HStack>
      {detail ? (
        <Box textStyle="2xs" fontFamily="mono" color="fg.subtle" truncate maxWidth="100%">
          {detail}
        </Box>
      ) : null}
    </VStack>
  );
}

/**
 * The bar under the headline: the measured one when the call reports counts,
 * the indeterminate sweep otherwise.
 */
function PendingProgress({
  sample,
  percent,
  reduceMotion,
}: {
  sample: LangyProgressSample | null | undefined;
  percent: number;
  reduceMotion: boolean;
}) {
  if (!sample) {
    return <Box className="langy-pending-bar" aria-hidden role="presentation" marginTop={0.5} />;
  }
  return (
    <VStack align="stretch" gap={1.5} marginTop={0.5}>
      <Box height="6px" borderRadius="full" background="langy.barTrack" overflow="hidden">
        <Box
          height="full"
          width={`${percent}%`}
          borderRadius="full"
          background="langy.barFill"
          transition={reduceMotion ? "none" : "width 180ms cubic-bezier(0.32, 0.72, 0, 1)"}
        />
      </Box>
      <HStack justify="space-between" gap={2}>
        <Text textStyle="2xs" color="fg.muted" fontFamily="mono" fontVariantNumeric="tabular-nums">
          {formatLangyProgressCount(sample)}
        </Text>
        <Text textStyle="2xs" color="fg.subtle" fontFamily="mono">
          {Math.round(percent)}%
        </Text>
      </HStack>
    </VStack>
  );
}
