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

/** The selected card follows the accent surface in either mode. */
export const SELECTED_SURFACE_BG = {
  light: "accent.subtle",
  dark: "accent.subtle",
} as const satisfies ColorModePair;

export const SELECTED_SURFACE_BORDER = {
  light: "accent.emphasized",
  dark: "accent.emphasized",
} as const satisfies ColorModePair;

/**
 * The icon chip. Slightly denser than the card wash above because it is a
 * small shape and needs the extra contrast to hold its edge.
 */
export const ACCENT_CHIP_BG = {
  light: "accent.subtle",
  dark: "accent.muted",
} as const satisfies ColorModePair;

export const ACCENT_CHIP_BORDER = {
  light: "accent.muted",
  dark: "accent.muted",
} as const satisfies ColorModePair;

export const selectedSurfaceBg = toConditional(SELECTED_SURFACE_BG);
export const selectedSurfaceBorder = toConditional(SELECTED_SURFACE_BORDER);
export const accentChipBg = toConditional(ACCENT_CHIP_BG);
export const accentChipBorder = toConditional(ACCENT_CHIP_BORDER);
