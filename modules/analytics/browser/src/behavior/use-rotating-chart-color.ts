import { system } from "@langwatch/design-system";
import { type RotatingColorSet, rotatingColors } from "@langwatch/design-system/rotating-colors";

const SERIES_ROLES = ["solid", "fg", "emphasized", "muted"] as const;
type ChartRole = "solid" | "fg" | "subtle" | "muted";

export const useGetRotatingColorForCharts = () => {
  return (set: RotatingColorSet, index: number, role?: ChartRole) => {
    const colorSet = rotatingColors[set];
    const palette = colorSet[index % colorSet.length]?.color.split(".")[0] ?? "gray";
    const seriesRole = set.endsWith("Tones") ? SERIES_ROLES[index % SERIES_ROLES.length] : "solid";
    return system.token.var(`colors.${palette}.${role ?? seriesRole}`);
  };
};
