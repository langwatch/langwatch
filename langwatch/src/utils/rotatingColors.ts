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
