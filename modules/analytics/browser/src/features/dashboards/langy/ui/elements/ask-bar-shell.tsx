/**
 * The look of the "What do you want to know?" bar, drawn once: Langy's gradient edge, the
 * sparkle, the words and the "Ask" pill. The board's bar and the field in "Add a widget" are
 * both made of it, so the click from one to the other lands on the same control.
 */

import { Box, chakra } from "@langwatch/design-system/primitives";
import { Sparkles } from "lucide-react";
import type { ReactNode } from "react";

/** The bar's words: its name on the board, its placeholder in "Add a widget". */
export const ASK_BAR_PROMPT = "What do you want to know?";

/** Langy's edge on a board: purple through pink to teal. */
export const LANGY_EDGE = {
  bgGradient: "to-r",
  gradientFrom: "purple.400/60",
  gradientVia: "pink.400/40",
  gradientTo: "teal.400/50",
} as const;

/** The prototype's hover ring: purple at a tenth, outside the gradient edge. */
const HALO = "0 0 0 4px color-mix(in srgb, var(--chakra-colors-purple-500) 10%, transparent)";

const SURFACE = {
  display: "flex",
  alignItems: "center",
  width: "full",
  height: "40px",
  gap: 2.5,
  paddingX: 4,
  borderRadius: "full",
  background: "bg.panel",
} as const;

/** The bar's purple ink, lighter on a dark panel: the light theme's purple is too dim there. */
const INK = { base: "purple.600", _dark: "purple.300" } as const;

/**
 * How the bar sets its words, resting or typed. Line heights are fixed here and on the pill: a
 * page and a dialog hand down different ones, which would move the words between the two.
 */
export const ASK_BAR_WORDS = {
  flex: 1,
  minWidth: 0,
  fontSize: "sm",
  lineHeight: "20px",
  fontWeight: "medium",
} as const;

/** The colour of the words nobody typed: the ink, held back. */
export const ASK_BAR_PROMPT_COLOR = { base: "purple.600/70", _dark: "purple.300/70" } as const;

const PILL = {
  flexShrink: 0,
  borderRadius: "full",
  paddingX: 2.5,
  paddingY: 0.5,
  background: "purple.subtle",
  color: INK,
  fontSize: "11px",
  lineHeight: "16px",
  fontWeight: "medium",
} as const;

export function AskBarShell({
  onPress,
  children,
}: {
  /** Given, the whole bar is one button named by its prompt; absent, it is a row of parts. */
  onPress?: () => void;
  /** The words and the pill, after the sparkle. */
  children: ReactNode;
}) {
  const parts = (
    <>
      <Box as="span" flexShrink={0} color={INK} display="flex">
        <Sparkles size={15} aria-hidden />
      </Box>
      {children}
    </>
  );
  return (
    <Box
      width="full"
      borderRadius="full"
      padding="1px"
      {...LANGY_EDGE}
      transition="box-shadow 0.15s"
      _hover={{ boxShadow: HALO }}
      _focusWithin={{ boxShadow: HALO }}
    >
      {onPress ? (
        <chakra.button
          type="button"
          aria-label={ASK_BAR_PROMPT}
          onClick={onPress}
          cursor="text"
          outline="none"
          textAlign="left"
          {...SURFACE}
        >
          {parts}
        </chakra.button>
      ) : (
        <chakra.div {...SURFACE}>{parts}</chakra.div>
      )}
    </Box>
  );
}

/** The "Ask" pill: part of the bar's face without a click, a button of its own with one. */
export function AskPill({ onClick }: { onClick?: () => void }) {
  if (!onClick) return <chakra.span {...PILL}>Ask</chakra.span>;
  return (
    <chakra.button
      type="button"
      cursor="pointer"
      _hover={{ background: "purple.muted" }}
      focusVisibleRing="outside"
      onClick={onClick}
      {...PILL}
    >
      Ask
    </chakra.button>
  );
}
