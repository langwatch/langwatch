import { Box, chakra, HStack, Text, VStack } from "@chakra-ui/react";
import { keyframes } from "@emotion/react";
import type { ReactNode } from "react";
import { useReducedMotion } from "~/hooks/useReducedMotion";
import "~/features/langy/langyTheme.css";
import { CARD_TAXONOMY, type LangyCardIntent, SERIF, TYPE } from "../tokens";
import { LangyPanelSurface } from "./LangyPanelSurface";

const dotPulse = keyframes`
  0%, 100% { opacity: 1; transform: scale(1); }
  50%      { opacity: 0.4; transform: scale(0.72); }
`;

/**
 * The one card primitive for Langy's conversation, driven by INTENT.
 *
 * A card names what it is doing — a small piece of work, progress on your
 * request, a change that landed, a question for you, something worth your full
 * attention — and the intent alone fixes the material (see `CARD_TAXONOMY`).
 * Every bespoke card composes THIS so the whole kit reads as one weight ramp
 * rather than five components each picking their own border and padding.
 *
 * The five intents, quietest to loudest:
 *   activity  — an inline status line, no box.
 *   progress  — a live receipt on a hairline surface, an amber dot while it runs.
 *   change    — a settled receipt, a status dot naming the outcome.
 *   ask       — leans in with the warm accent; expects an action row.
 *   spotlight — the panel material, a serif title, full attention.
 *
 * The accent is earned: only `ask` and `spotlight` spend it. `spotlight` renders
 * the real panel material (LangyPanelSurface); the rest are plain hairline boxes.
 */
export function LangyCard({
  intent,
  overline,
  title,
  dot,
  showDot,
  pulseDot = false,
  actions,
  children,
  role,
  "aria-label": ariaLabel,
}: {
  intent: LangyCardIntent;
  /** Mono eyebrow content (the caller may fold an icon in). */
  overline?: ReactNode;
  /** Card title. A string is styled per the intent; a node is rendered as-is. */
  title?: ReactNode;
  /** Status-dot colour override (a colour token). Defaults to the intent's tone. */
  dot?: string;
  /** Force the status dot on/off. Defaults on for the boxed non-spotlight intents. */
  showDot?: boolean;
  /** Pulse the dot — the card's work is live. Honoured only when the dot shows. */
  pulseDot?: boolean;
  /** Actions row (Apply / Discard / retry). Expected on `ask`. */
  actions?: ReactNode;
  children?: ReactNode;
  role?: string;
  "aria-label"?: string;
}) {
  const reduce = useReducedMotion();
  const variant = CARD_TAXONOMY[intent];
  const dotColor = dot ?? variant.dot;
  const dotOn =
    showDot ?? (!variant.inline && intent !== "spotlight" && Boolean(overline));

  const statusDot = dotOn ? (
    <Box
      width="6px"
      height="6px"
      borderRadius="full"
      flexShrink={0}
      background={dotColor}
      css={
        pulseDot && !reduce
          ? { animation: `${dotPulse} 1.4s ease-in-out infinite` }
          : undefined
      }
    />
  ) : null;

  // ── activity: an inline line, not a box ──────────────────────────────────
  if (variant.inline) {
    return (
      <HStack
        gap={2}
        align="center"
        alignSelf="flex-start"
        role={role ?? "status"}
        aria-label={ariaLabel}
        color="fg.muted"
      >
        {(showDot ?? true)
          ? statusDotForInline(dotColor, pulseDot, reduce)
          : null}
        {overline ? (
          <Text as="span" {...TYPE.sectionLabel} color="fg.subtle">
            {overline}
          </Text>
        ) : null}
        {typeof title === "string" ? (
          <Text as="span" textStyle="xs" color="fg.muted">
            {title}
          </Text>
        ) : (
          title
        )}
        {children}
      </HStack>
    );
  }

  // The eyebrow leads with the intent tone on the receipts, and stays subtle on
  // the accented cards where the warm material already carries the weight.
  const overlineColor =
    intent === "progress" || intent === "change" ? dotColor : "fg.subtle";
  const overlineRow = overline ? (
    <HStack
      gap={1.5}
      align="center"
      {...TYPE.sectionLabel}
      color={overlineColor}
    >
      {statusDot}
      <Box as="span">{overline}</Box>
    </HStack>
  ) : null;

  const titleNode =
    title == null ? null : typeof title === "string" ? (
      <Text
        color="fg"
        lineHeight="1.3"
        fontWeight={variant.titleWeight}
        fontFamily={variant.serifTitle ? SERIF : undefined}
        fontSize={variant.serifTitle ? "18px" : "13px"}
        letterSpacing={variant.serifTitle ? "-0.01em" : undefined}
      >
        {title}
      </Text>
    ) : (
      title
    );

  const body = (
    <VStack align="stretch" gap={2}>
      {overlineRow}
      {titleNode}
      {children}
      {actions ? <Box>{actions}</Box> : null}
    </VStack>
  );

  // ── spotlight: the full panel material ───────────────────────────────────
  if (variant.panelMaterial) {
    return (
      <LangyPanelSurface
        accent
        paddingX={variant.padding.x}
        paddingY={variant.padding.y}
        role={role ?? "group"}
        aria-label={ariaLabel}
      >
        {body}
      </LangyPanelSurface>
    );
  }

  // ── progress / change / ask: a hairline box, warm only when it's `ask` ────
  return (
    <Box
      className={variant.accent ? "langy-accent-ring" : undefined}
      position="relative"
      overflow="hidden"
      borderWidth="1px"
      borderStyle="solid"
      borderColor={variant.border}
      borderRadius={variant.radius}
      background={variant.surface}
      boxShadow="langyCard"
      paddingX={variant.padding.x}
      paddingY={variant.padding.y}
      role={role ?? "group"}
      aria-label={ariaLabel}
    >
      {variant.accent ? (
        <Box
          className="langy-accent-wash"
          aria-hidden
          position="absolute"
          inset="0"
          borderRadius="inherit"
          pointerEvents="none"
        />
      ) : null}
      <Box position="relative" zIndex={1}>
        {body}
      </Box>
    </Box>
  );
}

/** The inline (activity) dot: a touch smaller, matching the quiet line weight. */
function statusDotForInline(
  color: string,
  pulse: boolean,
  reduce: boolean,
): ReactNode {
  return (
    <Box
      width="5px"
      height="5px"
      borderRadius="full"
      flexShrink={0}
      background={color}
      css={
        pulse && !reduce
          ? { animation: `${dotPulse} 1.4s ease-in-out infinite` }
          : undefined
      }
    />
  );
}

/** Re-export the intent list for gallery / migration tooling. */
export { CARD_INTENTS } from "../tokens";
