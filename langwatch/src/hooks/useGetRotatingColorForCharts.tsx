import { getRawColorValue } from "../components/ui/color-mode";
import { type RotatingColorSet, rotatingColors } from "../utils/rotatingColors";

export const useGetRotatingColorForCharts = () => {
  return (set: RotatingColorSet, index: number, adjustment = 0) => {
    const [name, number] =
      rotatingColors[set]![index % rotatingColors[set]!.length]!.color.split(
        ".",
      );

    return getRawColorValue(
      `${name}.${Math.max(
        Math.min(parseInt(number ?? "0") + adjustment, 900),
        50,
      )}`,
    );
  };
};
