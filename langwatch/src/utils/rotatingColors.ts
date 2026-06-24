const tones = (color: string) => [
  {
    background: `${color}.800`,
    color: `${color}.400`,
  },
  {
    background: `${color}.100`,
    color: `${color}.600`,
  },
  {
    background: `${color}.200`,
    color: `${color}.700`,
  },
  {
    background: `${color}.300`,
    color: `${color}.800`,
  },
  {
    background: `${color}.400`,
    color: `${color}.900`,
  },
  {
    background: `${color}.600`,
    color: `${color}.200`,
  },
];

export const rotatingColors = {
  colors: [
    {
      background: "orange.subtle",
      color: "orange.emphasized",
    },
    {
      background: "blue.subtle",
      color: "blue.emphasized",
    },
    {
      background: "green.subtle",
      color: "green.emphasized",
    },
    {
      background: "yellow.subtle",
      color: "yellow.emphasized",
    },
    {
      background: "purple.subtle",
      color: "purple.emphasized",
    },
    {
      background: "teal.subtle",
      color: "teal.emphasized",
    },
    {
      background: "cyan.subtle",
      color: "cyan.emphasized",
    },
    {
      background: "pink.subtle",
      color: "pink.emphasized",
    },
  ],
  positiveNegativeNeutral: [
    {
      background: "green.subtle",
      color: "green.emphasized",
    },
    {
      background: "red.subtle",
      color: "red.emphasized",
    },
    {
      background: "gray.subtle",
      color: "gray.emphasized",
    },
  ],
  // Chart tones use numeric color values for brightness adjustments
  orangeTones: tones("orange"),
  blueTones: tones("blue"),
  greenTones: tones("green"),
  purpleTones: tones("purple"),
  yellowTones: tones("yellow"),
  tealTones: tones("teal"),
  cyanTones: tones("cyan"),
  pinkTones: tones("pink"),
  grayTones: tones("gray"),
  redTones: tones("red"),
} satisfies Record<string, { background: string; color: string }[]>;

const colorMap: Record<string, { background: string; color: string }> = {};

export type RotatingColorSet = keyof typeof rotatingColors;

/**
 * Bare Chakra `colorPalette` names derived from `rotatingColors.colors` (the
 * leading segment of each `background` token, e.g. `"orange.subtle"` →
 * `"orange"`), so a given string hashes to the same hue whether you ask for
 * the token pair (`getColorForString`) or the bare palette name
 * (`getColorPaletteForString`). Deriving from the single source keeps the
 * order in lockstep — reordering `rotatingColors.colors` can't desync the two
 * paths. The bare name feeds `<Badge colorPalette>` so the badge's bg/border/fg
 * are all mode-aware (good dark contrast) instead of a hand-picked
 * subtle/emphasized token pair.
 */
const ROTATING_PALETTES = rotatingColors.colors.map(
  (c) => c.background.split(".")[0]!,
);

export type RotatingPalette = string;

export const getColorPaletteForString = (str: string): RotatingPalette => {
  let sum = 0;
  for (let i = 0; i < str.length; i++) {
    sum += str.charCodeAt(i);
  }
  return ROTATING_PALETTES[sum % ROTATING_PALETTES.length]!;
};

export const getColorForString = (
  set: RotatingColorSet,
  str: string,
): { background: string; color: string } => {
  const key = set + str;
  if (colorMap[key]) {
    return colorMap[key]!;
  }

  let sum = 0;
  for (let i = 0; i < str.length; i++) {
    sum += str.charCodeAt(i);
  }

  colorMap[key] = rotatingColors[set]![sum % rotatingColors[set]!.length]!;
  return colorMap[key]!;
};

/**
 * Hex-string sibling of `getColorForString("colors", ...)` — same
 * sum-of-char-codes hash, same 8-color palette ordering — but returns
 * literal hex usable in Recharts SVG `fill` / `stroke`. Lets the
 * governance bird's-eye chart segments paint the exact same hue as
 * the ProjectAvatar / row-dot tokens for the same name, with no
 * Chakra-token-to-hex translation step.
 *
 * Palette values are Chakra v3 mid-saturation hex keyed by palette NAME, then
 * projected through `ROTATING_PALETTES` so the array lands in
 * `rotatingColors.colors` order automatically. Keying by name (rather than a
 * second hand-ordered array) means reordering or extending
 * `rotatingColors.colors` reshuffles the chart hues in lockstep — the index
 * desync this used to risk can't happen. A name that hashes to slot 3 paints
 * `yellow.subtle` in the avatar AND `#eab308` (yellow-500) in the chart.
 */
const PALETTE_HEX: Record<string, string> = {
  orange: "#f97316",
  blue: "#3b82f6",
  green: "#22c55e",
  yellow: "#eab308",
  purple: "#a855f7",
  teal: "#14b8a6",
  cyan: "#06b6d4",
  pink: "#ec4899",
};

const CHART_HEX_PALETTE = ROTATING_PALETTES.map(
  (palette) => PALETTE_HEX[palette] ?? PALETTE_HEX.orange!,
);

const hexColorMap: Record<string, string> = {};

export const getHexColorForString = (str: string): string => {
  const cached = hexColorMap[str];
  if (cached) return cached;
  let sum = 0;
  for (let i = 0; i < str.length; i++) {
    sum += str.charCodeAt(i);
  }
  const hex = CHART_HEX_PALETTE[sum % CHART_HEX_PALETTE.length]!;
  hexColorMap[str] = hex;
  return hex;
};
