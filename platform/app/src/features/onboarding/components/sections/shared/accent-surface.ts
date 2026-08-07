/**
 * The orange accent surfaces the onboarding screens paint on selected cards and
 * icon chips.
 *
 * These exist because a raw palette step is a light-mode-only decision. `bg`
 * set to `orange.50` renders the same near-white in both modes, while the text
 * on top of it follows `fg` and flips to near-white in dark mode — so the copy
 * disappears into its own card. Every accent surface in onboarding therefore
 * names both sides.
 *
 * The pairs are the source; the Chakra conditional objects are the convenient
 * form. A component that already holds a `useColorModeValue` call consumes the
 * pair, everything else spreads the conditional object straight onto the prop —
 * either way there is one place to change the accent.
 */

/** A light value and its dark-mode counterpart. */
interface ColorModePair {
  readonly light: string;
  readonly dark: string;
}

const toConditional = ({ light, dark }: ColorModePair) => ({
  base: light,
  _dark: dark,
});

/** Background of a card the user has picked. */
export const SELECTED_SURFACE_BG = {
  light: "orange.50",
  dark: "orange.950/30",
} as const satisfies ColorModePair;

/** Border of a card the user has picked. */
export const SELECTED_SURFACE_BORDER = {
  light: "orange.400",
  dark: "orange.800",
} as const satisfies ColorModePair;

/** Background of the small rounded box an accent icon sits in. */
export const ACCENT_CHIP_BG = {
  light: "orange.50",
  dark: "orange.950/40",
} as const satisfies ColorModePair;

/** Hairline around that same box. */
export const ACCENT_CHIP_BORDER = {
  light: "orange.100",
  dark: "orange.900",
} as const satisfies ColorModePair;

export const selectedSurfaceBg = toConditional(SELECTED_SURFACE_BG);
export const selectedSurfaceBorder = toConditional(SELECTED_SURFACE_BORDER);
export const accentChipBg = toConditional(ACCENT_CHIP_BG);
export const accentChipBorder = toConditional(ACCENT_CHIP_BORDER);
