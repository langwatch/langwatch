import { useTheme } from "@chakra-ui/react";
import { rotatingColors } from "../utils/rotatingColors";

export const useGetRotatingColorForCharts = () => {
  const theme = useTheme();

  return (index: number) => {
    const [name, number] = rotatingColors[index % rotatingColors.length]!.color.split(".");
    return theme.colors[name ?? ""][+(number ?? "") - 200];
  };
};
