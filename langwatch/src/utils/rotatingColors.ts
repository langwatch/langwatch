const tones = (color: string) => [
  {
    background: `${color}.subtle`,
    color: `${color}.fg`,
  },
  {
    background: `${color}.muted`,
    color: `${color}.fg`,
  },
  {
    background: `${color}.emphasized`,
    color: `${color}.fg`,
  },
  {
    background: `${color}.subtle`,
    color: `${color}.solid`,
  },
  {
    background: `${color}.muted`,
    color: `${color}.solid`,
  },
  {
    background: `${color}.solid`,
    color: `${color}.contrast`,
  },
];

// Chart-specific tones using numeric values for brightness adjustments
// These are used by useGetRotatingColorForCharts which needs numeric color values
const chartTones = (color: string) => [
  { background: `${color}.100`, color: `${color}.500` },
  { background: `${color}.200`, color: `${color}.600` },
  { background: `${color}.300`, color: `${color}.700` },
];

export const rotatingColors = {
  colors: [
    {
      background: "orange.subtle",
      color: "orange.fg",
    },
    {
      background: "blue.subtle",
      color: "blue.fg",
    },
    {
      background: "green.subtle",
      color: "green.fg",
    },
    {
      background: "yellow.subtle",
      color: "yellow.fg",
    },
    {
      background: "purple.subtle",
      color: "purple.fg",
    },
    {
      background: "teal.subtle",
      color: "teal.fg",
    },
    {
      background: "cyan.subtle",
      color: "cyan.fg",
    },
    {
      background: "pink.subtle",
      color: "pink.fg",
    },
  ],
  positiveNegativeNeutral: [
    {
      background: "green.subtle",
      color: "green.fg",
    },
    {
      background: "red.subtle",
      color: "red.fg",
    },
    {
      background: "gray.subtle",
      color: "gray.fg",
    },
  ],
  // Chart tones use numeric color values for brightness adjustments
  orangeTones: chartTones("orange"),
  blueTones: chartTones("blue"),
  greenTones: chartTones("green"),
  purpleTones: chartTones("purple"),
  yellowTones: chartTones("yellow"),
  tealTones: chartTones("teal"),
  cyanTones: chartTones("cyan"),
  pinkTones: chartTones("pink"),
  grayTones: chartTones("gray"),
  redTones: chartTones("red"),
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
