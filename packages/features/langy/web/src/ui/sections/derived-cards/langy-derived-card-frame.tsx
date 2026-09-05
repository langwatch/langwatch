/**
 * The derived chrome — provenance, styled ONCE (ADR-060 §4).
 */
import { HStack, Text, VStack } from "@chakra-ui/react";
import { Sparkles } from "lucide-react";
import type { ReactNode } from "react";

import { Tooltip } from "@langwatch/design-system/tooltip";
import { useReducedMotion } from "../../../behavior/use-reduced-motion";
import { langyThinkingShimmerStyles } from "../../../model/values/langy-shimmer";

/** The provenance line, and the longer answer behind it. */
const MADE_BY_LANGY_LABEL = "Made by Langy";
const MADE_BY_LANGY_HINT =
  "Langy put this view together from data it read in your project. The figures are yours — how they are grouped and drawn is Langy's suggestion, so give it a look before you pass it on.";

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
      <HStack
        gap={1}
        textStyle="2xs"
        fontWeight="500"
        letterSpacing="0.03em"
        textTransform="uppercase"
        color="purple.fg"
        width="fit-content"
      >
        <Sparkles size={11} />
        {forming ? (
          <Text as="span" css={shimmer}>
            Langy is making this
          </Text>
        ) : (
          <Tooltip content={MADE_BY_LANGY_HINT} showArrow openDelay={200}>
            {/* Reachable by keyboard: the explanation is the only place the
                calibration lives, so it cannot be hover-only. */}
            <Text as="span" tabIndex={0} cursor="help">
              {MADE_BY_LANGY_LABEL}
            </Text>
          </Tooltip>
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
