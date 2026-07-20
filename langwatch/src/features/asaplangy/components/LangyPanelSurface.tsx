import { Box, type BoxProps } from "@chakra-ui/react";
import { motion } from "motion/react";
import { useReducedMotion } from "~/hooks/useReducedMotion";
import "~/features/langy/langyTheme.css";
import { CARD } from "../tokens";

const MotionBox = motion.create(Box);

/**
 * The Langy panel's material, as a reusable home surface.
 *
 * The briefing panels on the home are meant to read as genuine Langy surfaces,
 * not generic cards — so they reuse the panel's own skin and texture stack
 * exactly (`langy-root` + the ink ground's signal grid and top brand glow;
 * light is the app's own clean surface), theme-aware, with content stacked
 * above the texture. The one thing it
 * leaves out is the animated fold: that seam is driven by Langy's live activity
 * (a turn in flight), which a static home panel doesn't have, so faking it here
 * would be motion with nothing behind it.
 *
 * `accent` gives the hero briefing its warmth — but as a SLOW BREATHING layer,
 * not a flat fill: the amber wash and the warm border ring drift in intensity
 * together over ~7s, so the accent reads alive and calmer at once (a static
 * bright orange border read as too intense). The breathing range is kept
 * deliberately low (peaks well under full strength) so the warmth is a hint of
 * Langy, not an orange card — toned down but still present. Plain surfaces
 * (status strip, setup) sit on the quiet panel tone with no accent.
 */
export function LangyPanelSurface({
  children,
  accent = false,
  fill = false,
  ...rest
}: BoxProps & { accent?: boolean; fill?: boolean }) {
  const reduce = useReducedMotion();
  // `fill` makes the whole surface stretch to the height its parent gives it (a
  // stretched grid cell, or a flex column that hands it `flex`), so a short card
  // never ends over a bare void next to a taller neighbour. It threads a flex
  // column through all three boxes — outer, card, content — so the CONTENT can
  // then distribute itself top-to-bottom (e.g. pin a footer to the bottom).
  // The same flex-column recipe applied to all three boxes, so `flex: 1`
  // propagates from the parent's height down to the content box.
  const fillColumn = fill
    ? ({
        flex: "1",
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
      } as const)
    : {};
  return (
    <Box className="langy-root" width="full" {...fillColumn}>
      <Box
        position="relative"
        overflow="hidden"
        borderRadius={CARD.radius}
        borderWidth={CARD.borderWidth}
        // The static edge is always the quiet neutral hairline; on the accent
        // card the WARM edge comes from the breathing ring below, so it shimmers
        // rather than sitting as a hard orange line.
        borderColor={CARD.border}
        background={CARD.bg}
        {...fillColumn}
        {...rest}
      >
        {/* Texture, under the content and inert to the pointer. Dark only,
            the light surface is the app's own clean panel. The glow is the ink
            ground's faint top-of-panel brand lift. */}
        <Box className="langy-signal-grid" aria-hidden />
        <Box className="langy-panel-glow" aria-hidden />

        {accent ? (
          <MotionBox
            // The wash + warm ring live in CSS (`.langy-accent-wash` +
            // `.langy-panel-accent-ring`) rather than inline style props, so the
            // Display-P3 upgrade (task #25) can layer over the exact same
            // declaration — an inline background can't be enriched by a class.
            // sRGB renderers get byte-for-byte the previous CARD.accentWash + ring.
            className="langy-accent-wash langy-panel-accent-ring"
            aria-hidden
            position="absolute"
            inset="0"
            pointerEvents="none"
            borderRadius="inherit"
            initial={false}
            animate={reduce ? { opacity: 0.55 } : { opacity: [0.4, 0.72, 0.4] }}
            transition={
              reduce
                ? { duration: 0 }
                : { duration: 7, repeat: Infinity, ease: "easeInOut" }
            }
          />
        ) : null}

        <Box position="relative" zIndex={1} {...fillColumn}>
          {children}
        </Box>
      </Box>
    </Box>
  );
}
