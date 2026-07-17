import { Box, HStack, Text } from "@chakra-ui/react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { LangyMark } from "~/features/langy/components/LangyMark";
import { useReducedMotion } from "~/hooks/useReducedMotion";
import { useColorModeValue } from "../ui/color-mode";
// The panel's texture sheet — the banner borrows its signal grid (see
// LangyBannerSignalGrid). Imported here too because the promo banner can
// render for users whose panel (the sheet's other importer) never mounts.
import "~/features/langy/langyTheme.css";

/**
 * The Langy home-banner's identity pieces (spec:
 * specs/home/langy-home-banner.feature).
 *
 * The Langy slide's background is the carousel's ONE shared MeshGradient —
 * the same instance the other banners run on, nothing layered over it — with
 * only its VALUES tuned (palette, shape, offsets, speed) to recreate the
 * Langy panel's inverted material: a calm surface-tone field under the copy
 * with one saturated accent mass gathered toward the right.
 *
 * The COPY wears the panel's skin, inverted against the app theme so the
 * banner reads as Langy arriving, not the page continuing:
 *
 *   - app dark  → the panel's PAPER view: cream field, ink serif heading;
 *   - app light → the panel's INK view: near-black field, paper-alpha text,
 *     brand + grey hairlines.
 *
 * Everything accent-coloured here is the site's brand ramp, nothing else —
 * the one-accent doctrine of the homepage's dark sections, not the AI
 * rainbow.
 */

// ---- The inverted tone -----------------------------------------------------

// Palette lifted from the marketing site (2lang-2watch / website-concept,
// src/index.css) — the same source langyTheme.ts drew from, at its CURRENT
// values: paper #f7f6f3, the ink ramp, and the violet brand ramp.
const PAPER = "#f7f6f3";
const PAPER_SOFT = "#efeee9";
const INK_950 = "#0a0a0c";
const INK_900 = "#141417";
const INK_700 = "#26261f";
const INK_500 = "#4d4d46";
const INK_100 = "#e3e2dd";
const BRAND_200 = "#cbc0ee";
const BRAND_300 = "#b1a3e8";
const BRAND_400 = "#8a76de";
const BRAND_500 = "#6e57d2";
const BRAND_600 = "#5b41c2";
const BRAND_700 = "#4a33a4";

export interface LangyBannerTone {
  /** true = the ink view (app light); false = the paper view (app dark). */
  ink: boolean;
  ground: string;
  heading: string;
  headingFont: string;
  subtitle: string;
  badgeColor: string;
  badgeBorder: string;
  iconBg: string;
  iconRing: string;
  ctaBg: string;
  ctaColor: string;
  ctaHoverBg: string;
  ctaActiveBg: string;
  kbdBg: string;
  kbdBorder: string;
  kbdColor: string;
  markStops: [string, string];
  askPrompt: string;
  askText: string;
  caret: string;
  /** The carousel chrome (dots / countdown ring / dismiss) over this slide. */
  chrome: {
    dot: string;
    dotIdle: string;
    dotHover: string;
    ring: string;
    ringTrack: string;
    dismiss: string;
    dismissHoverBg: string;
  };
}

/** The serif the panel's display type uses, with its own fallbacks. */
const LANGY_SERIF =
  'var(--langy-font-serif, "Sentient", "Charter", "Source Serif Pro", Georgia, serif)';

/**
 * The carousel's stock white-on-gradient chrome — what every non-Langy slide
 * uses (exported for HomePageBanners), and what the ink view keeps.
 */
export const WHITE_CHROME: LangyBannerTone["chrome"] = {
  dot: "white",
  dotIdle: "rgba(255,255,255,0.5)",
  dotHover: "rgba(255,255,255,0.7)",
  ring: "white",
  ringTrack: "rgba(255,255,255,0.28)",
  dismiss: "rgba(255,255,255,0.8)",
  dismissHoverBg: "rgba(255,255,255,0.2)",
};

/**
 * The Langy slide's resolved tone for the CURRENT app theme. Inverted on
 * purpose: the app's dark mode gets the panel's light (paper) skin and vice
 * versa, so the banner reads as Langy arriving, not the page continuing.
 */
export function useLangyBannerTone(): LangyBannerTone {
  // `ink` = the app is in LIGHT mode → the banner shows the ink view.
  const ink = useColorModeValue(true, false);
  if (ink) {
    // The Langy FLOATING PANEL's dark skin (langyTheme.ts), not the site's
    // violet: ink-950 ground, solid paper headings, paper/70 body, and the
    // panel's ORANGE brand-300 (#ffb380) as the one lit colour — on the
    // borders, the caret, the seam, the mark — over white/10-15 greys.
    return {
      ink,
      ground: INK_950,
      heading: PAPER,
      headingFont: LANGY_SERIF,
      subtitle: "rgba(247,246,243,0.82)",
      badgeColor: "#ffb380",
      badgeBorder: "rgba(255,179,128,0.45)",
      // No chip behind the mark — the panel sets its glyphs straight on
      // the ink; a washed-out circle just dilutes them.
      iconBg: "transparent",
      iconRing: "transparent",
      ctaBg: PAPER,
      ctaColor: INK_900,
      ctaHoverBg: PAPER_SOFT,
      ctaActiveBg: "#e3e2dc",
      kbdBg: "rgba(20,20,23,0.08)",
      kbdBorder: "rgba(20,20,23,0.18)",
      kbdColor: INK_900,
      markStops: ["#f56b1a", "#ffb380"],
      askPrompt: "#ffb380",
      askText: "rgba(247,246,243,0.92)",
      caret: "#ffb380",
      chrome: WHITE_CHROME,
    };
  }
  // The site's paper language: ink-900 headings, ink-500 body, ink-100
  // hairlines, brand-500/700 accents (its buttons are ink-900 pills that
  // hover to ink-700).
  return {
    ink,
    ground: PAPER,
    heading: INK_900,
    headingFont: LANGY_SERIF,
    subtitle: INK_500,
    badgeColor: BRAND_700,
    badgeBorder: "rgba(110,87,210,0.35)",
    iconBg: "transparent",
    iconRing: "transparent",
    ctaBg: INK_900,
    ctaColor: PAPER,
    ctaHoverBg: INK_700,
    ctaActiveBg: INK_950,
    kbdBg: "rgba(255,255,255,0.14)",
    kbdBorder: "rgba(255,255,255,0.25)",
    kbdColor: PAPER,
    markStops: [BRAND_600, BRAND_400],
    askPrompt: BRAND_500,
    askText: INK_700,
    caret: BRAND_500,
    chrome: {
      dot: INK_900,
      dotIdle: "rgba(20,20,23,0.3)",
      dotHover: "rgba(20,20,23,0.5)",
      ring: INK_900,
      ringTrack: "rgba(20,20,23,0.18)",
      dismiss: "rgba(20,20,23,0.55)",
      dismissHoverBg: "rgba(20,20,23,0.08)",
    },
  };
}

// ---- The mark ---------------------------------------------------------------

/**
 * Own paint-server id: the panel's gradient defs may already be on the page
 * (the launcher renders them), and duplicate SVG ids resolve to whichever
 * comes first in the DOM — so the banner brings its own. Its stops are the
 * site's brand ramp only (tone-resolved), not the AI rainbow.
 */
const BANNER_MARK_GRADIENT_ID = "langy-home-banner-mark-grad";

export function LangyBannerMark() {
  const tone = useLangyBannerTone();
  return (
    <>
      <svg
        width="0"
        height="0"
        aria-hidden
        style={{ position: "absolute", pointerEvents: "none" }}
      >
        <defs>
          <linearGradient
            id={BANNER_MARK_GRADIENT_ID}
            x1="0%"
            y1="100%"
            x2="100%"
            y2="0%"
          >
            <stop offset="0%" stopColor={tone.markStops[0]} />
            <stop offset="100%" stopColor={tone.markStops[1]} />
          </linearGradient>
        </defs>
      </svg>
      {/* No chip behind it (see the tone's transparent iconBg): the mark
			    stands straight on the surface, sized well clear of the ~22px
			    floor below which its wireframe smudges (see LangyMark). */}
      <LangyMark size={40} gradientId={BANNER_MARK_GRADIENT_ID} />
    </>
  );
}

// ---- The signal grid ----------------------------------------------------------

/**
 * The Langy panel's signal grid, borrowed for the banner's INK view — the
 * banner wears the panel's material, and on ink that material carries this
 * faint engineering grid (`.langy-signal-grid`, langyTheme.css). Same
 * geometry and masks as the panel; the `--banner` modifier supplies the line
 * colour (the banner sits outside `.langy-root`, so the panel's token never
 * resolves) and bypasses the `.dark` gate (the banner's ink ground shows in
 * app-LIGHT mode — the tone is inverted). The paper view keeps no grid, same
 * as the panel: grid on ink, grain on paper.
 */
export function LangyBannerSignalGrid() {
  const tone = useLangyBannerTone();
  if (!tone.ink) return null;
  return (
    <Box className="langy-signal-grid langy-signal-grid--banner" aria-hidden />
  );
}

// ---- The cycling ask-line ----------------------------------------------------

/**
 * Example asks, mirroring the panel's EmptyState SUGGESTIONS (shortened to a
 * banner-friendly single line). Every line must be a thing Langy can actually
 * do — a banner that promises what the product then fails at is worse than no
 * banner. Keep in sync with `features/langy/components/EmptyState.tsx`.
 */
const LANGY_ASKS = [
  "Find traces that failed their evaluations and tell me why",
  "Suggest an evaluator for my agent and set it up",
  "Compare my last two experiment runs",
] as const;

/** Dwell per ask; each change is one calm crossfade, no typing. */
const ASK_HOLD_MS = 4000;
const ASK_FADE_S = 0.45;

/** Index of the ask currently shown, advancing on a fixed clock. */
function useCyclingAsk(enabled: boolean): number {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(
      () => setIndex((i) => (i + 1) % LANGY_ASKS.length),
      ASK_HOLD_MS,
    );
    return () => clearInterval(timer);
  }, [enabled]);
  return index;
}

/**
 * A composer line quoting what you might ask: accent `›` prompt glyph, a
 * softly breathing caret, and the example ask crossfading on a slow clock —
 * a cycling input placeholder, not a typewriter (per-character typing read
 * as jittery). No ring and no fill: a quiet line resting straight on the
 * mesh's calm field. Deliberately NOT interactive — it demonstrates, the
 * CTA activates; two affordances for one action would compete. One line
 * high, so the carousel never resizes; long asks clip rather than wrap.
 */
export function LangyBannerAskLine() {
  const tone = useLangyBannerTone();
  const reduceMotion = useReducedMotion();
  const index = useCyclingAsk(!reduceMotion);
  return (
    <HStack gap={2.5} maxWidth="full" minWidth={0} aria-hidden>
      <Text
        textStyle="md"
        fontWeight="600"
        color={tone.askPrompt}
        flexShrink={0}
        lineHeight="24px"
      >
        ›
      </Text>
      {/* The caret sits where typing would begin; the ask reads as the
			    input's suggestion. Breathing fade, not a hard on/off blink. */}
      <Box flexShrink={0} display="flex" alignItems="center" height="24px">
        {reduceMotion ? (
          <Box width="2px" height="16px" bg={tone.caret} borderRadius="1px" />
        ) : (
          <motion.div
            animate={{ opacity: [0.9, 0.3, 0.9] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
            style={{
              width: 2,
              height: 16,
              background: tone.caret,
              borderRadius: 1,
            }}
          />
        )}
      </Box>
      <Box position="relative" minWidth={0} flex={1} height="24px">
        {/* True crossfade — outgoing and incoming ask overlap (absolute in
            the same slot), so the line never blinks empty between them. */}
        <AnimatePresence initial={false} mode="sync">
          <motion.div
            key={index}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: ASK_FADE_S, ease: "easeInOut" }}
            style={{ position: "absolute", inset: 0 }}
          >
            <Text
              textStyle="sm"
              fontWeight="500"
              color={tone.askText}
              lineHeight="24px"
              whiteSpace="nowrap"
              overflow="hidden"
              textOverflow="ellipsis"
            >
              {LANGY_ASKS[index]}
            </Text>
          </motion.div>
        </AnimatePresence>
      </Box>
    </HStack>
  );
}
