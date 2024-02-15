import { useTheme } from "@chakra-ui/react";
import { rotatingColors, type RotatingColorSet } from "../utils/rotatingColors";

export const useGetRotatingColorForCharts = () => {
  const theme = useTheme();

  return (set: RotatingColorSet, index: number) => {
    const [name, number] = rotatingColors[set]![index % rotatingColors[set]!.length]!.color.split(".");
    return theme.colors[name ?? ""][+(number ?? "")];
  };
};
