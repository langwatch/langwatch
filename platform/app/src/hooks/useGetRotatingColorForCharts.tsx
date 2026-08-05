import { getRawColorValue } from "../components/ui/color-mode";
import { type RotatingColorSet, rotatingColors } from "../utils/rotatingColors";

export const useGetRotatingColorForCharts = () => {
  return (set: RotatingColorSet, index: number, adjustment = 0) => {
    const colorSet = rotatingColors[set];
    if (!colorSet || colorSet.length === 0) {
      return getRawColorValue("gray.400");
    }
    const color = colorSet[index % colorSet.length]?.color ?? "gray.400";
    const [name, suffix] = color.split(".");

    // Semantic tokens (e.g. "green.emphasized") don't support numeric adjustment
    const numericValue = parseInt(suffix ?? "0");
    if (isNaN(numericValue)) {
      return getRawColorValue(color);
    }

    return getRawColorValue(
      `${name}.${Math.max(Math.min(numericValue + adjustment, 900), 50)}`,
    );
  };
};
