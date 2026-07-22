/**
 * The derived chrome — provenance, styled ONCE (ADR-060 §4).
 *
 * Every model-emitted card renders inside this frame and nowhere else gets
 * to look like it: a dashed hairline (no measured card in the kit is dashed)
 * and a purple "Derived by Langy" overline. A derived number must never pass
 * as a measured one, and the frame is the enforcement — per-card renderers
 * draw bodies, never chrome.
 *
 * The same frame carries the live-preview state: `forming` marks a card that
 * is still streaming (ADR-060 §7), shimmering the overline until the settled
 * part reconciles it.
 */
import { HStack, Text, VStack } from "@chakra-ui/react";
import { Sparkles } from "lucide-react";
import type { ReactNode } from "react";

import { useReducedMotion } from "~/hooks/useReducedMotion";
import { langyThinkingShimmerStyles } from "../langyShimmer";

export function LangyDerivedCardFrame({
  title,
  forming = false,
  superseded = false,
  children,
  actions,
}: {
  /** Card headline (the block's title / the question). Optional. */
  title?: ReactNode;
  /** Still streaming — settled parts reconcile this away (ADR-060 §7). */
  forming?: boolean;
  /** Render quieted (a superseded question stays readable, visibly closed). */
  superseded?: boolean;
  children?: ReactNode;
  /** Optional bound affordances (verify/explore chips, answer button). */
  actions?: ReactNode;
}) {
  const reduce = useReducedMotion();
  const shimmer = reduce
    ? { ...langyThinkingShimmerStyles, animation: "none" }
    : langyThinkingShimmerStyles;

  return (
    <VStack
      align="stretch"
      gap={1.5}
      borderWidth="1px"
      // Dashed is the provenance mark: nothing platform-measured is dashed.
      borderStyle="dashed"
      borderColor="purple.emphasized"
      borderRadius="langyCard"
      background="bg.subtle"
      paddingX="12px"
      paddingY="11px"
      opacity={superseded ? 0.65 : 1}
      role="group"
      data-derived-by-langy
    >
      <HStack
        gap={1}
        textStyle="2xs"
        fontWeight="500"
        letterSpacing="0.03em"
        textTransform="uppercase"
        color="purple.fg"
      >
        <Sparkles size={11} />
        {forming ? (
          <Text as="span" css={shimmer}>
            Derived by Langy · forming
          </Text>
        ) : (
          <Text as="span">Derived by Langy</Text>
        )}
      </HStack>

      {title !== undefined && title !== null ? (
        typeof title === "string" ? (
          <Text textStyle="xs" fontWeight="640" color="fg" lineHeight="1.3">
            {title}
          </Text>
        ) : (
          title
        )
      ) : null}

      {children}

      {actions !== undefined && actions !== null ? (
        <HStack gap={2} align="center" flexWrap="wrap">
          {actions}
        </HStack>
      ) : null}
    </VStack>
  );
}
