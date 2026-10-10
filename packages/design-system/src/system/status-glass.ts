/**
 * The status glass toasts and banners share: one hue per status drifting toward a neighbour, a
 * fine rim and a gloss. A toast wears it deep and saturated with white text; a banner wears a
 * pale tint of it with the ordinary foreground.
 */

/** Each status drifts toward one neighbour across the page, so it still reads as its own hue. */
export const STATUS_DRIFT = {
  red: "pink",
  orange: "yellow",
  green: "teal",
  blue: "purple",
} as const;

export type StatusHue = keyof typeof STATUS_DRIFT;

const step = (h: string, n: number) => `var(--chakra-colors-${h}-${n})`;

/** How each hue's toast is cut: which steps carry the field, and how far its chroma is lifted. */
const TOAST_CUT: Record<
  StatusHue,
  { weight: number; end: number; tail: [number, number]; glow: number; chroma: number }
> = {
  red: { weight: 50, end: 600, tail: [600, 700], glow: 500, chroma: 1.12 },
  orange: { weight: 50, end: 600, tail: [500, 600], glow: 500, chroma: 1.25 },
  green: { weight: 35, end: 700, tail: [600, 700], glow: 600, chroma: 1.25 },
  blue: { weight: 40, end: 700, tail: [600, 700], glow: 500, chroma: 1.25 },
};

/** Orange and its yellow drift run a step deeper, so the white title holds AA (4.5:1) on them. */
const deep = (h: string, n: number) => {
  if (n === 500) return step(h, 700);
  if (n === 600 || n === 700)
    return `color-mix(in srgb, ${step(h, 700)} ${n === 600 ? 72 : 45}%, ${step(h, 800)})`;
  return step(h, n);
};

/**
 * A light-mode toast is deep glass tinted with its status hue: a fine rim, a glow and a gloss,
 * its chroma lifted in oklch so it reads colourful rather than pale. Its tint is its own slice of
 * one viewport-sized field, offset by the card's placement (`--toast-shift`).
 */
export const toastGlass = (hue: StatusHue) => {
  const cut = TOAST_CUT[hue];
  const shade = (h: string, n: number) => (hue === "orange" ? deep(h, n) : step(h, n));
  const vivid = (color: string) => `oklch(from ${color} l calc(c * ${cut.chroma}) h)`;
  const alpha = (color: string, amount: string) =>
    vivid(`color-mix(in srgb, ${color} ${amount}, transparent)`);
  const c = (n: number, amount: string) => alpha(shade(hue, n), amount);
  const between = (a: number, b: number, weight = 50) =>
    alpha(`color-mix(in srgb, ${shade(hue, a)} ${weight}%, ${shade(hue, b)})`, "96%");
  const drift = (n: number, amount: string) =>
    alpha(`color-mix(in oklch, ${shade(STATUS_DRIFT[hue], n)} 60%, ${shade(hue, n)})`, amount);
  const field = "50% calc(100% + var(--viewport-offset-bottom, 1rem) - var(--toast-shift))";
  return {
    bg: between(600, 700, cut.weight),
    backgroundImage: [
      "linear-gradient(180deg, rgba(255, 255, 255, 0.07) 0%, transparent 45%)",
      `radial-gradient(40% 24% at 50% 100%, ${c(cut.glow, "62%")} 0%, transparent 100%)`,
      `linear-gradient(170deg, ${between(600, 700, cut.weight)} 0%, ${drift(600, "96%")} 50%, ${c(cut.end, "96%")} 75%, ${between(cut.tail[0], cut.tail[1])} 100%)`,
    ].join(", "),
    backgroundSize: "100% 100%, 100vw 100vh, 100vw 100vh",
    backgroundPosition: `0 0, ${field}, ${field}`,
    backgroundRepeat: "no-repeat",
    borderWidth: "1px",
    borderColor: `color-mix(in srgb, ${step(hue, 400)} 42%, transparent)`,
    backdropFilter: "var(--lw-backdrop-blur, blur(18px) saturate(160%))",
    boxShadow: `inset 0 1px 0 rgba(255, 255, 255, 0.12), 0 12px 32px -12px color-mix(in srgb, ${step(hue, 600)} 55%, transparent), 0 2px 6px rgba(2, 6, 23, 0.18)`,
  };
};

/** The banner's hairline: the status hue mixed into the neutral border. */
export const bannerRim = (hue: StatusHue) =>
  `color-mix(in srgb, ${step(hue, 500)} 28%, var(--chakra-colors-border))`;

/** A banner is the toast's pale sibling: a light tint of the same hue and drift, and a gloss. */
export const bannerGlass = (hue: StatusHue) => {
  const tint = (ground: string, amount: number, drift = false) =>
    `color-mix(in oklch, ${drift ? `color-mix(in oklch, ${step(STATUS_DRIFT[hue], 500)} 35%, ${step(hue, 500)})` : step(hue, 500)} ${amount}%, var(--chakra-colors-${ground}))`;
  const wash = (ground: string, amount: number, gloss: string) =>
    [
      `linear-gradient(180deg, ${gloss} 0%, transparent 70%)`,
      `linear-gradient(100deg, ${tint(ground, amount)} 0%, ${tint(ground, amount - 3, true)} 60%, ${tint(ground, amount)} 100%)`,
    ].join(", ");
  return {
    color: "fg",
    backgroundImage: {
      _light: wash("bg-surface", 11, "rgba(255, 255, 255, 0.55)"),
      _dark: wash("bg-panel", 16, "rgba(255, 255, 255, 0.04)"),
    },
  };
};
