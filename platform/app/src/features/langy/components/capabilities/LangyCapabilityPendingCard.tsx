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
import type { CapabilitySurface } from "./capabilityCatalog";
import { CapabilityRow, LangyCapabilityCard } from "./LangyCapabilityCard";
import { langyThinkingShimmerStyles } from "../langyShimmer";
import { useCapabilityData } from "../../hooks/useCapabilityData";
import type { CapabilityCommand } from "../../logic/langyCapabilityDigest";
import { useReducedMotion } from "~/hooks/useReducedMotion";
import type { LangyProgressSample } from "../../stores/langyStore";
import { useProjectedProgress } from "../StreamingStatusLine";
import {
  formatLangyPreviewCount,
  formatLangyProgressCount,
} from "../../logic/langyActivityOwnership";

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
}) {
  const reduceMotion = useReducedMotion();
  const shimmer = reduceMotion
    ? { ...langyThinkingShimmerStyles, animation: "none" }
    : langyThinkingShimmerStyles;

  // Start-frame hydration: only the query exists yet. Idle (and rendering
  // nothing extra) unless this resource has a query hydrator.
  const preview = useCapabilityData({ command: command ?? null });
  const percent = useProjectedProgress({ progress, sample: progressSample });
  const hasMeasuredProgress =
    progressSample !== null && progressSample !== undefined;

  return (
    <LangyCapabilityCard
      // Neutral tone on purpose — a create that hasn't landed is not a "created".
      tone="read"
      surface={surface}
      overline={overline}
      deepLink={false}
      title={
        <VStack align="stretch" gap={1}>
          <HStack gap={2} align="baseline">
            <Box
              textStyle="sm"
              fontWeight="640"
              lineHeight="1.3"
              css={shimmer}
              role="status"
              aria-live="polite"
            >
              {headline}…
            </Box>
          </HStack>
          {detail ? (
            <Box
              textStyle="2xs"
              fontFamily="mono"
              color="fg.subtle"
              truncate
              maxWidth="100%"
            >
              {detail}
            </Box>
          ) : null}
        </VStack>
      }
    >
      {hasMeasuredProgress ? (
        <VStack align="stretch" gap={1.5} marginTop={0.5}>
          <Box
            height="6px"
            borderRadius="full"
            background="langy.barTrack"
            overflow="hidden"
          >
            <Box
              height="full"
              width={`${percent}%`}
              borderRadius="full"
              background="langy.barFill"
              transition={
                reduceMotion
                  ? "none"
                  : "width 180ms cubic-bezier(0.32, 0.72, 0, 1)"
              }
            />
          </Box>
          <HStack justify="space-between" gap={2}>
            <Text
              textStyle="2xs"
              color="fg.muted"
              fontFamily="mono"
              fontVariantNumeric="tabular-nums"
            >
              {formatLangyProgressCount(progressSample)}
            </Text>
            <Text textStyle="2xs" color="fg.subtle" fontFamily="mono">
              {Math.round(percent)}%
            </Text>
          </HStack>
        </VStack>
      ) : (
        <Box
          className="langy-pending-bar"
          aria-hidden
          role="presentation"
          marginTop={0.5}
        />
      )}
      {preview.rows.length > 0 ? (
        <VStack align="stretch" gap={0}>
          {preview.rows.map((row) => (
            <Box
              key={row.id}
              css={
                reduceMotion
                  ? undefined
                  : { animation: `${rowAppear} 0.3s ease-out both` }
              }
            >
              <CapabilityRow
                primary={row.primary ?? row.id}
                secondary={row.secondary}
              />
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
