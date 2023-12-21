export const rotatingColors: { background: string; color: string }[] = [
  {
    background: "orange.100",
    color: "orange.600",
  },
  {
    background: "blue.50",
    color: "blue.600",
  },
  {
    background: "green.50",
    color: "green.600",
  },
  {
    background: "yellow.100",
    color: "yellow.700",
  },
  {
    background: "purple.50",
    color: "purple.600",
  },
  {
    background: "teal.50",
    color: "teal.700",
  },
  {
    background: "cyan.50",
    color: "cyan.700",
  },
  {
    background: "pink.50",
    color: "pink.700",
  },
];

const colorMap: Record<string, { background: string; color: string }> = {};

export const getColorForString = (
  str: string
): { background: string; color: string } => {
  if (colorMap[str]) {
    return colorMap[str]!;
  }

  let sum = 0;
  for (let i = 0; i < str.length; i++) {
    sum += str.charCodeAt(i);
  }

  colorMap[str] = rotatingColors[sum % rotatingColors.length]!;
  return colorMap[str]!;
};