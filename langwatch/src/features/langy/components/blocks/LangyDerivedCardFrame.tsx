/**
 * The derived chrome — provenance, styled ONCE (ADR-060 §4).
 *
 * Every model-emitted card renders inside this frame and nowhere else gets to
 * look like it: a dashed hairline, and no measured card in the kit is dashed.
 * A derived number must never pass as a measured one, and the frame is the
 * enforcement — per-card renderers draw bodies, never chrome.
 *
 * It says this by LOOKING different, not by announcing it. The frame used to
 * carry a standing "Derived by Langy" overline, which was on every derived
 * card without exception — a mark that varies with nothing carries no
 * information, and it spent a line of every card having the product hedge
 * about its own output in vocabulary ("derived") no reader uses. The dashed
 * rule keeps derived content from reading as measured content, which was the
 * actual requirement.
 *
 * The one thing worth SAYING is transient: `forming` marks a card still
 * streaming (ADR-060 §7), and shimmers until the settled part reconciles it.
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
      // The provenance hooks. Tests (and any future styling) key off these
      // rather than the chrome's wording — the wording is copy and copy moves.
      data-derived-by-langy
      data-derived-forming={forming ? "true" : undefined}
    >
      {forming ? (
        <HStack
          gap={1}
          textStyle="2xs"
          fontWeight="500"
          letterSpacing="0.03em"
          textTransform="uppercase"
          color="purple.fg"
        >
          <Sparkles size={11} />
          <Text as="span" css={shimmer}>
            Forming
          </Text>
        </HStack>
      ) : null}

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
