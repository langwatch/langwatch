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
 * Palette is the `colors` set hard-coded as Chakra v3 mid-saturation
 * hex (orange-500/blue-500/green-500/yellow-500/purple-500/teal-500/
 * cyan-500/pink-500). Order matters — must match `rotatingColors.colors`
 * indices so a name that hashes to slot 3 paints `yellow.subtle` in
 * the avatar AND `#eab308` (yellow-500) in the chart.
 */
const CHART_HEX_PALETTE = [
  "#f97316", // orange.500 → matches rotatingColors.colors[0] (orange.subtle)
  "#3b82f6", // blue.500   → [1] (blue.subtle)
  "#22c55e", // green.500  → [2] (green.subtle)
  "#eab308", // yellow.500 → [3] (yellow.subtle)
  "#a855f7", // purple.500 → [4] (purple.subtle)
  "#14b8a6", // teal.500   → [5] (teal.subtle)
  "#06b6d4", // cyan.500   → [6] (cyan.subtle)
  "#ec4899", // pink.500   → [7] (pink.subtle)
] as const;

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
