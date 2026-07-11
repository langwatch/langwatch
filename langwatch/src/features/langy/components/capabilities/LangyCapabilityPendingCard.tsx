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
 */
import { Box, HStack, VStack } from "@chakra-ui/react";
import type { CapabilitySurface } from "./capabilityRegistry";
import { LangyCapabilityCard } from "./LangyCapabilityCard";
import { langyThinkingShimmerStyles } from "../langyShimmer";
import { useReducedMotion } from "~/hooks/useReducedMotion";

export function LangyCapabilityPendingCard({
  surface,
  overline,
  headline,
  detail,
}: {
  surface: CapabilitySurface;
  overline: string;
  /** Present tense: "Searching traces", "Creating evaluator". */
  headline: string;
  /** The concrete thing being acted on, when the call's input names one. */
  detail?: string;
}) {
  const reduceMotion = useReducedMotion();
  const shimmer = reduceMotion
    ? { ...langyThinkingShimmerStyles, animation: "none" }
    : langyThinkingShimmerStyles;

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
      <Box
        className="langy-pending-bar"
        aria-hidden
        role="presentation"
        marginTop={0.5}
      />
    </LangyCapabilityCard>
  );
}
