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
      background: "orange.100",
      color: "orange.400",
    },
    {
      background: "blue.50",
      color: "blue.400",
    },
    {
      background: "green.50",
      color: "green.400",
    },
    {
      background: "yellow.100",
      color: "yellow.500",
    },
    {
      background: "purple.50",
      color: "purple.400",
    },
    {
      background: "teal.50",
      color: "teal.500",
    },
    {
      background: "cyan.50",
      color: "cyan.500",
    },
    {
      background: "pink.50",
      color: "pink.500",
    },
  ],
  positiveNegativeNeutral: [
    {
      background: "green.100",
      color: "green.400",
    },
    {
      background: "red.100",
      color: "red.400",
    },
    {
      background: "gray.100",
      color: "gray.400",
    },
  ],
  orangeTones: tones("orange"),
  blueTones: tones("blue"),
  greenTones: tones("green"),
  purpleTones: tones("purple"),
  yellowTones: tones("yellow"),
  tealTones: tones("teal"),
  cyanTones: tones("cyan"),
  pinkTones: tones("pink"),
  grayTones: tones("gray"),
} satisfies Record<string, { background: string; color: string }[]>;

const colorMap: Record<string, { background: string; color: string }> = {};

export type RotatingColorSet = keyof typeof rotatingColors;

export const getColorForString = (
  set: RotatingColorSet,
  str: string
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
