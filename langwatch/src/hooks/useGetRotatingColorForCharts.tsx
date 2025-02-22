import { rotatingColors, type RotatingColorSet } from "../utils/rotatingColors";
import { getComputedCSSVariableValue } from "../components/ui/color-mode";

export const useGetRotatingColorForCharts = () => {
  return (set: RotatingColorSet, index: number) => {
    const [name, number] =
      rotatingColors[set]![index % rotatingColors[set]!.length]!.color.split(
        "."
      );
    const cssVariable = `--chakra-colors-${name}-${number}`;

    return getComputedCSSVariableValue(cssVariable) ?? "pink";
  };
};
