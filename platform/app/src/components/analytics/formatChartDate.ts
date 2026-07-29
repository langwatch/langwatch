import { format } from "date-fns";

/**
 * Formats a date string for chart axis ticks and tooltips.
 * Returns empty string for falsy or unparseable values so recharts
 * never receives an invalid Date (which would crash date-fns format).
 */
export const formatChartDate = ({
  date,
  timeScale,
  daysDifference,
}: {
  date: string;
  timeScale: "full" | number;
  daysDifference: number;
}): string => {
  if (!date) return "";

  const parsed = new Date(date);
  if (isNaN(parsed.getTime())) return "";

  if (typeof timeScale === "number" && timeScale < 1440) {
    if (daysDifference > 1) {
      return format(parsed, "MMM d HH:mm");
    }
    return format(parsed, "HH:mm");
  }

  return format(parsed, "MMM d");
};
