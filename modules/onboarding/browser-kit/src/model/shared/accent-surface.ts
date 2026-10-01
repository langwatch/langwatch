/**
 * Defines light/dark color pairs for accent surfaces to avoid light-mode-only
 * palette steps.
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

/**
 * The picked-card surface. Its dark side is a 30% wash rather than solid
 * `orange.950` so the card still reads as lifted off the panel behind it.
 */
export const SELECTED_SURFACE_BG = {
  light: "orange.50",
  dark: "orange.950/30",
} as const satisfies ColorModePair;

export const SELECTED_SURFACE_BORDER = {
  light: "orange.400",
  dark: "orange.800",
} as const satisfies ColorModePair;

/**
 * The icon chip. Slightly denser than the card wash above because it is a
 * small shape and needs the extra contrast to hold its edge.
 */
export const ACCENT_CHIP_BG = {
  light: "orange.50",
  dark: "orange.950/40",
} as const satisfies ColorModePair;

export const ACCENT_CHIP_BORDER = {
  light: "orange.100",
  dark: "orange.900",
} as const satisfies ColorModePair;

export const selectedSurfaceBg = toConditional(SELECTED_SURFACE_BG);
export const selectedSurfaceBorder = toConditional(SELECTED_SURFACE_BORDER);
export const accentChipBg = toConditional(ACCENT_CHIP_BG);
export const accentChipBorder = toConditional(ACCENT_CHIP_BORDER);
